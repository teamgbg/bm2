import { DASHBOARD_PORT, METRICS_PORT } from "../constants";
import { formatBytes, formatUptime, colorize, padRight } from "../utils";
import { sendToDaemon } from "../daemon-client";
import { statusColor } from "../colors";

export async function cmdMonit() {
  const res = await sendToDaemon({ type: "metrics" });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }

  const snapshot = res.data;
  console.log(colorize("\n⚡ BM2 Monitor\n", "bold"));

  console.log(colorize("System:", "cyan"));
  console.log(`  Platform : ${snapshot.system.platform}`);
  console.log(`  CPUs     : ${snapshot.system.cpuCount}`);
  console.log(`  Memory   : ${formatBytes(snapshot.system.totalMemory - snapshot.system.freeMemory)} / ${formatBytes(snapshot.system.totalMemory)}`);
  console.log(`  Load avg : ${snapshot.system.loadAvg.map((l: number) => l.toFixed(2)).join(", ")}`);
  console.log();

  console.log(colorize("Processes:", "cyan"));
  for (const p of snapshot.processes) {
    const statusStr = colorize(padRight(p.status, 14), statusColor(p.status));
    console.log(
      `  ${padRight(String(p.id), 4)} ${padRight(p.name, 20)} ${statusStr} CPU: ${padRight(p.cpu.toFixed(1) + "%", 8)} MEM: ${padRight(formatBytes(p.memory), 10)} ↺ ${p.restarts}`
    );
  }
  console.log();
}

export async function cmdDashboard(args: string[]) {
  let port = DASHBOARD_PORT;
  let metricsPort = METRICS_PORT;

  const portIdx = args.indexOf("--port");
  if (portIdx !== -1 && args[portIdx + 1]) port = parseInt(args[portIdx + 1]!);
  const mIdx = args.indexOf("--metrics-port");
  if (mIdx !== -1 && args[mIdx + 1]) metricsPort = parseInt(args[mIdx + 1]!);

  const res = await sendToDaemon({ type: "dashboard", data: { port, metricsPort } });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  console.log(colorize(`✓ Dashboard running at http://localhost:${res.data.port}`, "green"));
  console.log(colorize(`  Prometheus metrics at http://localhost:${res.data.metricsPort}/metrics`, "dim"));
}

export async function cmdDashboardStop() {
  const res = await sendToDaemon({ type: "dashboardStop" });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  console.log(colorize("✓ Dashboard stopped", "green"));
}

export async function cmdPrometheus() {
  const res = await sendToDaemon({ type: "prometheus" });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  console.log(res.data);
}
