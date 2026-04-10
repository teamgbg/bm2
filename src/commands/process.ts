import path, { resolve, extname } from "path";
import { colorize } from "../utils";
import { formatBytes, formatUptime, padRight } from "../utils";
import { sendToDaemon } from "../daemon-client";
import { loadEcosystemConfig } from "../config-loader";
import { parseStartFlags } from "../cli-args";
import { liveWatchProcess, printProcessTable } from "../process-table";
import type { ProcessState } from "../types";
import { statusColor } from "../colors";

export async function cmdStart(args: string[]) {
  
  const scriptOrConfig = args[0];
  
  if (!scriptOrConfig) {
    console.error(colorize("Usage: bm2 start <script|config> [options]", "red"));
    process.exit(1);
  }

  const ext = extname(scriptOrConfig);

  if (
    ext === ".json" ||
    scriptOrConfig.includes("ecosystem") ||
    scriptOrConfig.includes("bm2.config") || 
    scriptOrConfig.includes("pm2.config")
  ) {
    const config = await loadEcosystemConfig(scriptOrConfig);
    const res = await sendToDaemon({ type: "ecosystem", data: config });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process.exit(1);
    }
    printProcessTable(res.data);
    return;
  }

  const opts = parseStartFlags(args.slice(1), resolve(scriptOrConfig));
  opts.script = resolve(scriptOrConfig);
  
  const cwd = path.dirname(opts.script);

  const res = await sendToDaemon({ type: "start", data: { config: opts, cwd } });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  printProcessTable(res.data);
}

export async function cmdStop(args: string[]) {
  const target = args[0] || "all";
  const type = target === "all" ? "stopAll" : "stop";
  const data = target === "all" ? undefined : { target };

  const res = await sendToDaemon({ type, data });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  printProcessTable(res.data);
}

export async function cmdRestart(args: string[]) {
  const target = args[0] || "all";
  const type = target === "all" ? "restartAll" : "restart";
  const data = target === "all" ? undefined : { target };

  const res = await sendToDaemon({ type, data });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  printProcessTable(res.data);
}

export async function cmdReload(args: string[]) {
  const target = args[0] || "all";
  const type = target === "all" ? "reloadAll" : "reload";
  const data = target === "all" ? undefined : { target };

  const res = await sendToDaemon({ type, data });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  printProcessTable(res.data);
}

export async function cmdDelete(args: string[]) {
  const target = args[0] || "all";
  const type = target === "all" ? "deleteAll" : "delete";
  const data = target === "all" ? undefined : { target };

  const res = await sendToDaemon({ type, data });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process?.exit(1);
  }
  
  console.log(colorize("✓ Deleted", "green"));
  printProcessTable(res.data);
}

export async function cmdList(args: string[]) {
  const res = await sendToDaemon({ type: "list" });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  
  let liveMode = false;
  
  for (let arg of args) {
    switch (arg) {
      case "--live":
        liveMode = true;
        break;
      default:
    }
  }
  
  if (liveMode) {
    liveWatchProcess(res.data)
  } else {
    printProcessTable(res.data);
  }
}

export async function cmdDescribe(args: string[]) {
  const target = args[0];
  if (!target) {
    console.error(colorize("Usage: bm2 describe <id|name>", "red"));
    process.exit(1);
  }

  const res = await sendToDaemon({ type: "describe", data: { target } });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }

  const processes: ProcessState[] = res.data;
  for (const p of processes) {
    console.log(colorize(`\n─── ${p.name} (id: ${p.pm_id}) ───`, "bold"));
    console.log(`  Status       : ${colorize(p.status, statusColor(p.status))}`);
    console.log(`  PID          : ${p.pid || "N/A"}`);
    console.log(`  Exec mode    : ${p.bm2_env.execMode}`);
    console.log(`  Instances    : ${p.bm2_env.instances}`);
    console.log(`  Namespace    : ${p.namespace || "default"}`);
    console.log(`  Script       : ${p.bm2_env.script}`);
    console.log(`  CWD          : ${p.bm2_env.cwd}`);
    console.log(`  Args         : ${p.bm2_env.args.join(" ") || "(none)"}`);
    console.log(`  Interpreter  : ${p.bm2_env.interpreter || "bun"}`);
    console.log(`  Restarts     : ${p.bm2_env.restart_time}`);
    console.log(`  Unstable     : ${p.bm2_env.unstable_restarts}`);
    console.log(
      `  Uptime       : ${
        p.status === "online" ? formatUptime(Date.now() - p.bm2_env.pm_uptime) : "N/A"
      }`
    );
    console.log(`  Created at   : ${new Date(p.bm2_env.created_at).toISOString()}`);
    console.log(`  CPU          : ${p.monit.cpu.toFixed(1)}%`);
    console.log(`  Memory       : ${formatBytes(p.monit.memory)}`);
    if (p.monit.handles !== undefined)
      console.log(`  Handles      : ${p.monit.handles}`);
    if (p.monit.eventLoopLatency !== undefined)
      console.log(`  EL Latency   : ${p.monit.eventLoopLatency.toFixed(2)} ms`);
    console.log(`  Watch        : ${p.bm2_env.watch}`);
    console.log(`  Autorestart  : ${p.bm2_env.autorestart}`);
    console.log(`  Max restarts : ${p.bm2_env.maxRestarts}`);
    console.log(`  Kill timeout : ${p.bm2_env.killTimeout} ms`);
    if (p.bm2_env.healthCheckUrl)
      console.log(`  Health URL   : ${p.bm2_env.healthCheckUrl}`);
    if (p.bm2_env.cronRestart)
      console.log(`  Cron restart : ${p.bm2_env.cronRestart}`);
    if (p.bm2_env.port)
      console.log(`  Port         : ${p.bm2_env.port}`);
    console.log();
  }
}

export async function cmdScale(args: string[]) {
  const target = args[0];
  const count = parseInt(args[1]!);
  if (!target || isNaN(count)) {
    console.error(colorize("Usage: bm2 scale <name|id> <count>", "red"));
    process.exit(1);
  }

  const res = await sendToDaemon({ type: "scale", data: { target, count } });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  printProcessTable(res.data);
}

export async function cmdReset(args: string[]) {
  const target = args[0] || "all";
  const res = await sendToDaemon({ type: "reset", data: { target } });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  console.log(colorize("✓ Restart counters reset", "green"));
  printProcessTable(res.data);
}

export async function cmdSignal(args: string[]) {
  const signal = args[0];
  const target = args[1];
  if (!signal || !target) {
    console.error(colorize("Usage: bm2 sendSignal <signal> <id|name>", "red"));
    process.exit(1);
  }

  const res = await sendToDaemon({ type: "signal", data: { target, signal } });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  console.log(colorize(`✓ Signal ${signal} sent to ${target}`, "green"));
}
