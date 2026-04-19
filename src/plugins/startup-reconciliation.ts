/**
 * @system bm2
 * @status handwritten
 * @edit edit directly
 *
 * Startup reconciliation plugin — reaps orphan listeners that predate the daemon.
 *
 * On daemon boot (after ecosystem config is loaded but before services start),
 * scans /proc for processes whose cmdline matches known bm2 service scripts
 * but are not currently tracked. Kills with SIGTERM → 3s grace → SIGKILL.
 *
 * Logs loudly so operators can see what was reaped.
 */
import { readFileSync, readdirSync } from "node:fs";
import { kill as processKill } from "node:process";
import { pluginRegistry } from "./registry";
import type { ProcessDescription } from "../types";

const GRACE_MS = 3000;

const knownScripts = new Set<string>();

export function registerKnownScript(script: string): void {
  knownScripts.add(script);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTrackedPids(): Set<number> {
  const pids = new Set<number>();
  try {
    const entries = readdirSync("/proc");
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = parseInt(entry, 10);
      if (pid === process.pid) continue;
      try {
        const environ = readFileSync(`/proc/${pid}/environ`, "utf-8");
        if (environ.includes("BM2_NAME=")) {
          pids.add(pid);
        }
      } catch {
        // process gone
      }
    }
  } catch {}
  return pids;
}

function readCmdline(pid: number): string | null {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf-8").replace(/\0/g, " ").trim();
  } catch {
    return null;
  }
}

function getPidChildren(pid: number): number[] {
  const children: number[] = [];
  try {
    const entries = readdirSync("/proc");
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      const ppid = parseInt(entry, 10);
      if (ppid === pid) children.push(ppid);
    }
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, "utf-8");
        const start = stat.indexOf("(");
        const end = stat.indexOf(")", start);
        const afterComm = stat.substring(end + 2);
        const fields = afterComm.split(" ");
        const parentPid = parseInt(fields[2] ?? "", 10);
        if (parentPid === pid) {
          const childPid = parseInt(entry, 10);
          if (!children.includes(childPid)) children.push(childPid);
        }
      } catch {}
    }
  } catch {}
  return children;
}

function killWithGrace(pid: number, serviceName: string): void {
  try {
    processKill(pid, "SIGTERM");
    console.log(`[bm2] reaper: SIGTERM pid=${pid} (${serviceName})`);
  } catch (err: any) {
    if (err.code === "ESRCH") return;
    console.log(`[bm2] reaper: SIGTERM failed for pid=${pid}: ${err.message}`);
    return;
  }

  let killed = false;
  const checkInterval = setInterval(() => {
    try {
      processKill(pid, 0);
    } catch {
      killed = true;
      clearInterval(checkInterval);
      return;
    }
  }, 500);

  setTimeout(async () => {
    clearInterval(checkInterval);
    if (!killed) {
      try {
        processKill(pid, "SIGKILL");
        console.log(`[bm2] reaper: SIGKILL pid=${pid} (${serviceName}) after grace`);
      } catch (err: any) {
        if (err.code !== "ESRCH") {
          console.log(`[bm2] reaper: SIGKILL failed for pid=${pid}: ${err.message}`);
        }
      }
    }
  }, GRACE_MS).unref();
}

function killDescendants(pid: number): void {
  const children = getPidChildren(pid);
  for (const child of children) {
    killDescendants(child);
    try {
      process.kill(child, "SIGTERM");
      console.log(`[bm2] reaper: SIGTERM descendant pid=${child}`);
    } catch {}
  }
}

async function reconcile(): Promise<void> {
  if (knownScripts.size === 0) return;

  const tracked = getTrackedPids();
  const orphans: Array<{ pid: number; cmdline: string; script: string }> = [];

  try {
    const entries = readdirSync("/proc");
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = parseInt(entry, 10);
      if (pid === process.pid) continue;
      if (tracked.has(pid)) continue;

      const cmdline = readCmdline(pid);
      if (!cmdline) continue;

      for (const script of knownScripts) {
        const interp = script.endsWith(".ts") ? "bun" : script.endsWith(".js") ? "node" : null;
        const fullMatch = cmdline.includes(script);
        const interpMatch = interp ? cmdline.includes(interp) && cmdline.includes(script) : fullMatch;

        if (interpMatch || fullMatch) {
          orphans.push({ pid, cmdline, script });
          break;
        }
      }
    }
  } catch {}

  if (orphans.length === 0) return;

  const serviceNames = orphans
    .map((o) => o.script.split("/").pop())
    .filter(Boolean)
    .join(", ");

  console.log(
    `[bm2] reaper: found ${orphans.length} orphan${orphans.length > 1 ? "s" : ""} on boot: ${serviceNames}`
  );

  for (const orphan of orphans) {
    killDescendants(orphan.pid);
    killWithGrace(orphan.pid, orphan.script);
  }
}

pluginRegistry.registerDaemonHooks({
  onDaemonBoot: async () => {
    console.log("[bm2] startup-reconciliation: running orphan scan...");
    await reconcile();
  },
});

pluginRegistry.registerProcessContainerHooks({
  onBeforeSpawn: (config: ProcessDescription) => {
    if (config.script) {
      registerKnownScript(config.script);
    }
  },
});