import { colorize } from "../utils";
import { sendToDaemon } from "../daemon-client";

export async function cmdLogs(args: string[]) {
  const target = args[0] || "all";
  let lines = 20;
  const linesIdx = args.indexOf("--lines");
  if (linesIdx !== -1 && args[linesIdx + 1]) {
    lines = parseInt(args[linesIdx + 1]!);
  }

  const res = await sendToDaemon({ type: "logs", data: { target, lines } });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }

  for (const log of res.data) {
    console.log(colorize(`\n─── ${log.name} (id: ${log.id}) ───`, "bold"));
    if (log.out) {
      console.log(colorize("--- stdout ---", "dim"));
      console.log(log.out);
    }
    if (log.err) {
      console.log(colorize("--- stderr ---", "red"));
      console.log(log.err);
    }
  }
}

export async function cmdFlush(args: string[]) {
  const target = args[0];
  const res = await sendToDaemon({ type: "flush", data: target ? { target } : undefined });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  console.log(colorize("✓ Logs flushed", "green"));
}
