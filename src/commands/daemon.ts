import { existsSync, unlinkSync } from "fs";
import { DAEMON_SOCKET, DAEMON_PID_FILE } from "../constants";
import { colorize, formatUptime } from "../utils";
import { sendToDaemon } from "../daemon-client";

export async function cmdPing() {
  try {
    const res = await sendToDaemon({ type: "ping" });
    if (res.success) {
      console.log(colorize("✓ Daemon is alive", "green"));
      console.log(`  PID    : ${res.data.pid}`);
      console.log(`  Uptime : ${formatUptime(res.data.uptime * 1000)}`);
    } else {
      console.log(colorize("✗ Daemon responded with error", "red"));
    }
  } catch {
    console.log(colorize("✗ Daemon is not running", "red"));
  }
}

export async function cmdKill() {
  try {
    await sendToDaemon({ type: "kill" });
  } catch {
  }

  try {
    if (existsSync(DAEMON_SOCKET)) unlinkSync(DAEMON_SOCKET);
  } catch {}
  try {
    if (existsSync(DAEMON_PID_FILE)) unlinkSync(DAEMON_PID_FILE);
  } catch {}

  console.log(colorize("✓ Daemon killed", "green"));
}

export async function cmdDaemon(args: string[]) {
  const subCmd = args[0];
  let type;
  
  switch (subCmd) {
    case "reload":
      type = "daemonReload"
      break;
    default:
      console.error(colorize("Usage: bm2 daemon <reload>", "red"));
      process.exit(1);
  }
  
  const res = await sendToDaemon({ type });
    
  if (res?.error) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  
  console.log(colorize(res.data, "green"));
  
  process.exit(1);
  
}
