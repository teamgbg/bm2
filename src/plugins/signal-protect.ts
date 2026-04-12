/**
 * @system bm2
 * @status handwritten
 * @edit edit directly

 * Signal protection plugin - wraps protected processes with bm2-signal-protect binary.
 */
import { pluginRegistry } from "./registry";
import type { ProcessDescription } from "../types";
import { DAEMON_PID_FILE } from "../constants";

function getDaemonPidSync(): string {
  try {
    const { readFileSync } = require("fs");
    const content = readFileSync(DAEMON_PID_FILE, "utf-8").trim();
    return content;
  } catch {}
  return String(process.pid);
}

pluginRegistry.registerProcessContainerHooks({
  onBeforeSpawn: (
    config: ProcessDescription,
    cmd: string[],
    env: Record<string, string>
  ) => {
    if (!config.protected) return;

    const daemonPid = getDaemonPidSync();
    const wrapperPath = import.meta.dir + "/../bin/bm2-signal-protect";
    const newCmd = [wrapperPath, daemonPid, ...cmd];
    const newEnv = {
      ...env,
      BM2_DAEMON_PID: daemonPid,
      BM2_PROTECTED: "1",
    };
    return { cmd: newCmd, env: newEnv };
  },
});