#!/usr/bin/env bun
/**
 * @system bm2
 * @status handwritten
 * @edit edit directly
 *
 * Boot script for WSL2 startup. Reads service_env + secret rows from the
 * registry directly and starts BM2 with an in-memory ecosystem. There is
 * NO codegen step and NO committed ecosystem JSON file. The DB IS the
 * source of truth for what BM2 supervises.
 *
 * Boot does NOT install per-service dependencies — that is the
 * canonical-pipeline concern of `bm2 restart <service>`. Boot trusts
 * existing install state and starts every supervised service. A service
 * with a stale node_modules surfaces its failure to its own log and
 * is fixed by `bm2 restart <service>`, not by re-installing every
 * service on every reboot.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { SQL } from "bun";

// BM2's existing config-loader expects a file path; boot.ts writes the
// ecosystem to a per-boot tmp file. The file is ephemeral, regenerated
// on every boot from the DB, and never committed to git.
const ECOSYSTEM_TMP = process.env.BM2_ECOSYSTEM || `/tmp/bm2-ecosystem-${process.pid}.json`;

async function run(cmd: string, args: string[], cwd: string): Promise<number> {
  const proc = Bun.spawn([cmd, ...args], { cwd, stdout: "inherit", stderr: "inherit" });
  const exit = await proc.exited;
  if (exit !== 0) {
    console.error(`[boot] ${cmd} ${args.join(" ")} failed (exit ${exit}) in ${cwd}`);
  }
  return exit;
}

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const bootstrap = `${process.env.HOME}/.config/scala/bootstrap.env`;
  if (existsSync(bootstrap)) {
    const m = readFileSync(bootstrap, "utf8").match(/^DATABASE_URL=(.+)$/m);
    if (m?.[1]) return m[1].replace(/^["']|["']$/g, "");
  }
  throw new Error("DATABASE_URL not set and ~/.config/scala/bootstrap.env missing");
}

async function buildEcosystemFromRegistry(mode: string): Promise<string> {
  const sql = new SQL(loadDatabaseUrl());
  try {
    const services = await sql`
      SELECT slug, config
      FROM public.registry_entries
      WHERE type = 'service_env' AND is_active = true
    `;
    if (services.length === 0) {
      throw new Error("No active service_env rows in registry");
    }
    const secretRows = await sql`
      SELECT config
      FROM public.registry_entries
      WHERE type = 'secret' AND is_active = true
    `;
    const sharedSecrets: Record<string, string> = {};
    for (const row of secretRows) {
      const cfg = (row.config ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(cfg)) {
        if (typeof v === "string") sharedSecrets[k] = v;
      }
    }
    const apps = services.map((entry: { slug: string; config: Record<string, unknown> }) => {
      const cfg = entry.config;
      const env: Record<string, string> = {};
      if (Array.isArray(cfg.secrets)) {
        for (const k of cfg.secrets as string[]) {
          if (sharedSecrets[k]) env[k] = sharedSecrets[k];
        }
      }
      if (cfg.env && typeof cfg.env === "object") {
        Object.assign(env, cfg.env as Record<string, string>);
      }
      const svcMode = (cfg.mode as string) || "development";
      const app: Record<string, unknown> = {
        name: entry.slug,
        cwd: cfg.cwd,
        env,
        autorestart: cfg.autorestart ?? false,
        restartDelay: cfg.restartDelay ?? 2000,
        maxRestarts: cfg.maxRestarts ?? 10,
        minUptime: cfg.minUptime ?? 5000,
        watch: false,
        script: cfg.script,
        interpreter: cfg.interpreter,
      };
      if (cfg.args) app.args = cfg.args;
      if (svcMode === "production") {
        app.env = { ...(app.env as Record<string, string>), NODE_ENV: "production" };
      }
      if (svcMode === "development" && cfg.interpreterArgs) {
        app.interpreterArgs = cfg.interpreterArgs;
      }
      if (cfg.healthCheckUrl) {
        app.healthCheckUrl = cfg.healthCheckUrl;
        app.healthCheckInterval = cfg.healthCheckInterval;
        app.healthCheckTimeout = cfg.healthCheckTimeout;
        app.healthCheckMaxFails = cfg.healthCheckMaxFails;
      }
      if (cfg.canonicalProbeUrl) app.canonicalProbeUrl = cfg.canonicalProbeUrl;
      if (cfg.maxMemoryRestart) app.maxMemoryRestart = cfg.maxMemoryRestart;
      return app;
    });
    return JSON.stringify({ apps }, null, 2);
  } finally {
    await sql.end();
  }
}

async function boot() {
  const mode = process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1]
    || process.env.BM2_MODE
    || "development";

  console.log(`[boot] mode=${mode}`);
  console.log(`[boot] reading service_env rows from registry...`);

  let ecosystemJson: string;
  try {
    ecosystemJson = await buildEcosystemFromRegistry(mode);
  } catch (err) {
    console.error(`[boot] failed to read ecosystem from DB:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }
  writeFileSync(ECOSYSTEM_TMP, ecosystemJson);
  console.log(`[boot] ecosystem materialised to ${ECOSYSTEM_TMP} from DB`);

  // Lazy-install: any app whose declared `script` artefact does not exist on
  // disk gets installed via the canonical scala-tools deps install before BM2
  // tries to spawn it. Boot stays fast in the steady state (no installs when
  // node_modules is already populated), AND becomes self-healing when a
  // service was wiped or never bootstrapped — without needing manual
  // `bm2 restart <service>` after every reboot. Per `wsl2-boot-chain`'s
  // intent (fast boot) plus the operator's reliability requirement (every
  // declared service runs after reboot).
  const ecosystem = JSON.parse(ecosystemJson) as { apps: Array<Record<string, unknown>> };
  const apps = ecosystem.apps ?? [];
  const needsInstall: Array<{ name: string; cwd: string }> = [];
  for (const app of apps) {
    const cwd = app.cwd as string | undefined;
    const script = app.script as string | undefined;
    const name = app.name as string | undefined;
    if (!cwd || !script || !name) continue;
    if (!existsSync(`${cwd}/package.json`)) continue;
    const scriptPath = script.startsWith("/") ? script : `${cwd}/${script}`;
    if (!existsSync(scriptPath)) needsInstall.push({ name, cwd });
  }
  if (needsInstall.length > 0) {
    console.log(`[boot] ${needsInstall.length} services missing install artefacts; installing in parallel: ${needsInstall.map((s) => s.name).join(", ")}`);
    // Tell scala-tools deps install how many siblings are in flight so it
    // can divide bun's network-concurrency budget across them and avoid
    // hammering a single-process Verdaccio v6.
    const peers = String(needsInstall.length);
    const installs = needsInstall.map(async ({ name, cwd }) => {
      const start = Date.now();
      const proc = Bun.spawn(["bun", "x", "scala-tools", "deps", "install"], {
        cwd,
        stdout: "inherit",
        stderr: "inherit",
        env: {
          ...process.env,
          BM2_INTERNAL_INSTALL: "1",
          SCALA_INSTALL_PARALLEL_PEERS: peers,
        },
      });
      const exit = await proc.exited;
      const sec = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[boot] install ${name}: exit=${exit} (${sec}s)`);
      return { name, exit };
    });
    const results = await Promise.all(installs);
    const failed = results.filter((r) => r.exit !== 0);
    if (failed.length > 0) {
      console.warn(`[boot] ${failed.length} services failed to install: ${failed.map((r) => r.name).join(", ")} — they will not start, but boot continues so the rest go online`);
    }
  } else {
    console.log(`[boot] every app's script artefact is present on disk; no installs needed`);
  }

  // Reap any pre-existing bm2-daemon process before we start. Without this,
  // `bm2 start` discovers an existing daemon (left over from another shell's
  // `bm2 boot` — common when an agent in a tmux pane started its own daemon)
  // and reuses it instead of spawning one in our cgroup. Children then inherit
  // the wrong cgroup, the `enforce-bm2-slice` gate refuses them, and recovery
  // requires manual intervention. Reaping first makes boot.ts always own the
  // daemon spawn so the daemon inherits OUR cgroup (bm2-local.service →
  // Slice=bm2.slice via the drop-in).
  console.log(`[boot] reaping any pre-existing bm2 daemons (orphan-class prevention)`);
  Bun.spawnSync(["pkill", "-9", "-f", "bm2/src/daemon.ts"], { stdout: "ignore", stderr: "ignore" });
  await new Promise((r) => setTimeout(r, 500));

  console.log(`[boot] starting BM2...`);
  const bm2Exit = await run("bm2", ["start", ECOSYSTEM_TMP], join(import.meta.dir, ".."));

  // bm2 start returns non-zero if any individual service failed to spawn
  // (missing binary, broken script path, etc.). That does NOT mean the daemon
  // itself failed. Boot succeeds when the daemon is alive and supervising at
  // least one service — per-service failures are bm2's own concern and are
  // fixed by `bm2 restart <service>`. Probing the daemon is the verification
  // that matters at the systemd boundary.
  let onlineCount = 0;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const probe = Bun.spawn(["bm2", "list"], { stdout: "pipe", stderr: "pipe" });
    const probeOut = await new Response(probe.stdout).text();
    await probe.exited;
    onlineCount = (probeOut.match(/online/g) ?? []).length;
    if (onlineCount > 0) break;
  }
  if (onlineCount === 0) {
    console.error(`[boot] BM2 start failed — daemon reports no online services after 30s (bm2 start exit=${bm2Exit})`);
    process.exit(1);
  }
  console.log(`[boot] online — daemon supervising ${onlineCount} services in ${mode} mode (bm2 start exit=${bm2Exit})`);

  // ── Type=simple supervision tail ────────────────────────────────────────────
  // For systemd to apply Restart=always to the actual daemon (not just the
  // boot script), this process must stay alive as long as the daemon does.
  // We find bm2-daemon's PID and poll its existence; when it dies we exit
  // non-zero, which triggers systemd's Restart=always.
  //
  // This is the modern shape: systemd supervises THIS process, this process
  // monitors the daemon, daemon death → boot.ts exits → systemd respawns
  // boot.ts → boot.ts re-runs codegen + bm2 start → daemon comes back.
  // The bm2-watchdog.timer becomes redundant once this is in place.
  const findDaemonPid = (): number | null => {
    const r = Bun.spawnSync(["pgrep", "-f", "bm2/src/daemon.ts"]);
    const out = new TextDecoder().decode(r.stdout).trim();
    if (!out) return null;
    const pid = parseInt(out.split("\n")[0]!, 10);
    return Number.isFinite(pid) ? pid : null;
  };
  const pidIsAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  // The supervised daemon MUST live in bm2-local.service's cgroup (which
  // inherits Slice=bm2.slice via the systemd drop-in). Any other cgroup —
  // `app-tmux.slice/tmux-spawn-*.scope`, anything else — means the daemon
  // was spawned by another shell and we're about to "supervise" an orphan
  // whose children fail the `enforce-bm2-slice` gate. Refuse to attach and
  // let systemd restart us; the reaper at the top of boot() then kills the
  // orphan before we re-run `bm2 start`, which now spawns OUR daemon.
  const daemonCgroupOK = (pid: number): boolean => {
    try {
      const cg = readFileSync(`/proc/${pid}/cgroup`, "utf-8");
      return /\/bm2-local\.service|\/bm2\.slice\b/.test(cg);
    } catch {
      return false;
    }
  };

  let daemonPid = findDaemonPid();
  if (!daemonPid) {
    console.error("[boot] daemon PID not found via pgrep — cannot supervise; exiting (systemd will retry)");
    process.exit(1);
  }
  if (!daemonCgroupOK(daemonPid)) {
    let cg = "";
    try { cg = readFileSync(`/proc/${daemonPid}/cgroup`, "utf-8").trim(); } catch {}
    console.error(`[boot] daemon pid=${daemonPid} is in wrong cgroup (${cg}) — orphan from another shell. Killing and exiting so systemd respawns clean.`);
    try { process.kill(daemonPid, "SIGKILL"); } catch {}
    process.exit(1);
  }
  console.log(`[boot] supervising bm2-daemon pid=${daemonPid}`);

  while (true) {
    await new Promise((r) => setTimeout(r, 5000));
    if (!pidIsAlive(daemonPid!)) {
      console.error(`[boot] bm2-daemon pid=${daemonPid} died — exiting so systemd can restart`);
      process.exit(1);
    }
    // Recheck PID in case daemon was restarted by another path
    const current = findDaemonPid();
    if (current && current !== daemonPid) {
      if (!daemonCgroupOK(current)) {
        console.error(`[boot] daemon PID changed to ${current} which is in wrong cgroup — orphan. Killing and exiting.`);
        try { process.kill(current, "SIGKILL"); } catch {}
        process.exit(1);
      }
      console.log(`[boot] daemon PID changed: ${daemonPid} → ${current}`);
      daemonPid = current;
    }
  }
}

process.on("SIGTERM", async () => {
  console.log("[boot] SIGTERM received — shutting down BM2...");
  await run("bm2", ["kill"], join(import.meta.dir, ".."));
  process.exit(0);
});

boot().catch((err) => {
  console.error("[boot] fatal:", err);
  process.exit(1);
});
