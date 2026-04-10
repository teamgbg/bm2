import { colorize } from "../utils";
import { sendToDaemon } from "../daemon-client";
import { printProcessTable } from "../process-table";

export async function cmdSave() {
  const res = await sendToDaemon({ type: "save" });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  console.log(colorize("✓ Process list saved", "green"));
}

export async function cmdResurrect() {
  const res = await sendToDaemon({ type: "resurrect" });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  printProcessTable(res.data);
}
