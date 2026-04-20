/**
 * @system bm2
 * @status handwritten
 * @edit edit directly
 *
 * Process-group-reaper plugin — kills orphan listeners that cause EADDRINUSE on restart.
 *
 * Hook call ordering (deterministic): plugins/index.ts imports run in declaration order,
 * each calling pluginRegistry.registerProcessContainerHooks(). The container iterates
 * the array in registration order. signal-protect (imported first) prepends its wrapper,
 * then this plugin (imported last) wraps the entire result with setsid.
 * Final cmd: [setsid, bm2-signal-protect, <daemonPid>, <original_cmd>...]
 */
import { readFileSync, existsSync } from "node:fs";
import { pluginRegistry } from "./registry";
import type { ProcessDescription } from "../types";

const SETSID_PATH = "/usr/bin/setsid";
const REAPER_PGID_KEY = "__reaperPgid";
const GRACE_MS = 3000;

export let daemonStartTime = 0;

export function setDaemonStartTime(ts: number): void {
  daemonStartTime = ts;
}

function setsidAvailable(): boolean {
  return existsSync(SETSID_PATH);
}

function readPgid(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
    const start = stat.indexOf("(");
    const end = stat.indexOf(")", start);
    const afterComm = stat.substring(end + 2);
    const fields = afterComm.split(" ");
    const pgrp = fields[1];
    if (pgrp === undefined) return null;
    return parseInt(pgrp, 10);
  } catch {
    return null;
  }
}

function portToHex(port: number): string {
  return port.toString(16).padStart(4, "0").toUpperCase();
}

function findPidHoldingPort(port: number): number | null {
  const hex = portToHex(port);
  const files = ["/proc/net/tcp", "/proc/net/tcp6"];
  for (const file of files) {
    try {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i]!.trim().split(/\s+/);
        if (cols.length < 10) continue;
        const localAddr = cols[1];
        if (localAddr === undefined) continue;
        const addrParts = localAddr.split(":");
        if (addrParts.length !== 2) continue;
        const addrPort = addrParts[1];
        if (addrPort === undefined) continue;
        if (addrPort.toUpperCase() === hex && cols[3] === "0A") {
          const inodeStr = cols[9];
          if (inodeStr === undefined) continue;
          return parseInt(inodeStr, 10);
        }
      }
    } catch {}
  }
  return null;
}

function isBm2Tracked(pid: number): boolean {
  try {
    const environ = readFileSync(`/proc/${pid}/environ`, "utf-8");
    return environ.includes("BM2_NAME=");
  } catch {
    return false;
  }
}

function isPortStillBound(port: number): boolean {
  return findPidHoldingPort(port) !== null;
}

function isGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

function getProcessStartTime(pid: number): number {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
    const start = stat.indexOf("(");
    const end = stat.indexOf(")", start);
    const afterComm = stat.substring(end + 2);
    const fields = afterComm.split(" ");
    const starttime = fields.length > 20 ? parseInt(fields[20] ?? "0", 10) : 0;
    if (!starttime) return 0;
    const uptime = readFileSync("/proc/uptime", "utf-8").split(" ")[0];
    const uptimeSeconds = parseFloat(uptime);
    const ticksPerSec = 100;
    return Math.floor((uptimeSeconds - starttime / ticksPerSec) * 1000);
  } catch {
    return 0;
  }
}

function isStaleOrphan(pid: number): boolean {
  if (daemonStartTime === 0) return true;
  const processStart = getProcessStartTime(pid);
  if (processStart === 0) return true;
  return processStart < daemonStartTime;
}

function killOrphanOnPort(port: number, serviceName: string): void {
  const holderPid = findPidHoldingPort(port);
  if (holderPid === null) return;
  if (holderPid === process.pid) return;
  if (isBm2Tracked(holderPid) && !isStaleOrphan(holderPid)) {
    console.log(
      `[reaper] port ${port} held by bm2-tracked pid=${holderPid}, skipping (live service)`
    );
    return;
  }
  try {
    process.kill(holderPid, "SIGKILL");
    console.log(
      `[reaper] killed orphan pid=${holderPid} holding port=${port} for service=${serviceName}`
    );
  } catch (err: any) {
    console.log(
      `[reaper] failed to kill orphan pid=${holderPid} on port=${port}: ${err.message}`
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

pluginRegistry.registerProcessContainerHooks({
  onBeforeSpawn: (
    config: ProcessDescription,
    cmd: string[],
    env: Record<string, string>
  ) => {
    if (config.port !== undefined && config.port > 0) {
      killOrphanOnPort(config.port, config.name);
    }

    if (!setsidAvailable()) {
      console.log(
        `[reaper] ${SETSID_PATH} not found, process group isolation disabled for ${config.name}`
      );
      return;
    }

    return { cmd: [SETSID_PATH, ...cmd] };
  },

  onAfterStart: (container: any) => {
    const pid = container?.pid as number | undefined;
    if (pid == null) return;
    const pgid = readPgid(pid);
    if (pgid !== null) {
      (container as any)[REAPER_PGID_KEY] = pgid;
      console.log(
        `[reaper] ${container.name}: pid=${pid} pgid=${pgid}`
      );
    }
  },
});

pluginRegistry.registerProcessManagerHooks({
  onAfterStop: async (container: any) => {
    const pgid = container?.[REAPER_PGID_KEY] as number | undefined;
    if (pgid == null) return;

    const port = container?.config?.port as number | undefined;
    const name = container?.name as string | undefined;

    try {
      process.kill(-pgid, "SIGTERM");
      console.log(`[reaper] ${name}: SIGTERM sent to process group ${pgid}`);
    } catch (err: any) {
      if (err.code === "ESRCH") {
        console.log(`[reaper] ${name}: process group ${pgid} already gone`);
        return;
      }
      console.log(
        `[reaper] ${name}: SIGTERM failed for pgid=${pgid}: ${err.message}`
      );
      return;
    }

    await sleep(GRACE_MS);

    if (isGroupAlive(pgid)) {
      try {
        process.kill(-pgid, "SIGKILL");
        console.log(
          `[reaper] ${name}: SIGKILL sent to surviving process group ${pgid}`
        );
      } catch (err: any) {
        if (err.code !== "ESRCH") {
          console.log(
            `[reaper] ${name}: SIGKILL failed for pgid=${pgid}: ${err.message}`
          );
        }
      }
    }

    if (port !== undefined && isPortStillBound(port)) {
      const remaining = findPidHoldingPort(port);
      console.log(
        `[reaper] ${name}: port ${port} still held by pid=${remaining} after group reap`
      );
      if (remaining !== null && !isBm2Tracked(remaining)) {
        try {
          process.kill(remaining, "SIGKILL");
          console.log(
            `[reaper] ${name}: killed residual holder pid=${remaining} on port ${port}`
          );
        } catch {}
      }
    }
  },
});
