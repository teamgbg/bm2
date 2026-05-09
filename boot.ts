#!/usr/bin/env bun
/**
 * @system bm2
 * @status handwritten
 * @edit edit directly
 *
 * Boot script for WSL2 startup. Generates the ecosystem config from
 * registry rows, then starts BM2 with the ecosystem file.
 *
 * Boot does NOT install per-service dependencies — that is the
 * canonical-pipeline concern of `bm2 restart <service>`. Boot trusts
 * existing install state and starts every supervised service. A service
 * with a stale node_modules surfaces its failure to its own log and
 * is fixed by `bm2 restart <service>`, not by re-installing every
 * service on every reboot.
 */

import { existsSync } from "fs";
import { join } from "path";

const ECOSYSTEM_PATH =
  process.env.BM2_ECOSYSTEM ||
  join(import.meta.dir, "..", "infra-config", "ecosystem.bm2.local.json");

async function run(cmd: string, args: string[], cwd: string): Promise<number> {
  const proc = Bun.spawn([cmd, ...args], { cwd, stdout: "inherit", stderr: "inherit" });
  const exit = await proc.exited;
  if (exit !== 0) {
    console.error(`[boot] ${cmd} ${args.join(" ")} failed (exit ${exit}) in ${cwd}`);
  }
  return exit;
}

async function boot() {
  const mode = process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1]
    || process.env.BM2_MODE
    || "development";

  console.log(`[boot] mode=${mode}`);
  console.log(`[boot] generating ecosystem from database...`);

  const codegenExit = await run("scala-tools", [
    "codegen", "run", "--output", "ecosystem",
  ], join(import.meta.dir, ".."));

  if (codegenExit !== 0) {
    console.error("[boot] codegen failed, aborting");
    process.exit(1);
  }

  if (!existsSync(ECOSYSTEM_PATH)) {
    console.error(`[boot] ecosystem not found at ${ECOSYSTEM_PATH}`);
    process.exit(1);
  }

  console.log(`[boot] starting BM2...`);
  const bm2Exit = await run("bm2", ["start", ECOSYSTEM_PATH], join(import.meta.dir, ".."));

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

  let daemonPid = findDaemonPid();
  if (!daemonPid) {
    console.error("[boot] daemon PID not found via pgrep — cannot supervise; exiting (systemd will retry)");
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
