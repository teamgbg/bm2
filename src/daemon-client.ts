import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import {
  DAEMON_SOCKET,
  DAEMON_PID_FILE,
  DAEMON_OUT_LOG_FILE,
  DAEMON_ERR_LOG_FILE,
} from "./constants";
import { colorize } from "./utils";
import type { DaemonMessage, DaemonResponse } from "./types";

export function isDaemonRunning(): boolean {
  if (!existsSync(DAEMON_PID_FILE)) return false;
  try {
    const pid = parseInt(readFileSync(DAEMON_PID_FILE, "utf-8").trim());
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startDaemon(): Promise<void> {
  if (isDaemonRunning()) return;

  const daemonScript = join(import.meta.dir, "daemon.ts");
  const bunPath = Bun.which("bun") || "bun";
  
  const stdout = Bun.file(DAEMON_OUT_LOG_FILE);
  const stderr = Bun.file(DAEMON_ERR_LOG_FILE);
  
  if (!(await stdout.exists())) await Bun.write(stdout, "");
  if (!(await stderr.exists())) await Bun.write(stderr, "");
    
  const child = Bun.spawn([bunPath, "run", daemonScript], {
    stdout,
    stderr,
    stdin: "ignore",
  });

  child.unref();

  console.error(colorize("Starting daemon..", "green"));
  
  for (let i = 0; i < 100; i++) {
    if (isDaemonRunning()) return;
    
    await Bun.sleep(1_000);
    console.error(colorize("Waiting for daemon..", "cyan"));
  }
  
  if (!isDaemonRunning()) {
    throw new Error("Daemon failed to start (socket not found after 5 s)");
  }
}

export async function sendToDaemon(msg: DaemonMessage): Promise<DaemonResponse> {
    
  await startDaemon();
    
  let res;
    
  try {
      
    const uri = `http://localhost/command`
    
    res = await fetch(uri, {
      unix: DAEMON_SOCKET,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(msg),
    });
    
    if (!res.ok) {
      throw new Error(`Daemon error: ${res.status}`);
    }
    
    const resJson: DaemonResponse = await res.json() as DaemonResponse;
    
    return resJson;
      
  } catch (e: any) {
    console.log("Results returned: " + await res?.text())
    console.log()
    console.log("sendToDaemon#Error:", e, e.stack)
    return { type: "error", error: "Fetch Error", success: false }
  }
  
}
