import { colorize } from "../utils";
import { sendToDaemon } from "../daemon-client";

export async function cmdModule(args: string[]) {
  const subCmd = args[0];

  switch (subCmd) {
    case "install": {
      const mod = args[1];
      if (!mod) {
        console.error(colorize("Usage: bm2 module install <name|url|path>", "red"));
        process.exit(1);
      }
      const res = await sendToDaemon({ type: "moduleInstall", data: { module: mod } });
      if (!res.success) {
        console.error(colorize(`Error: ${res.error}`, "red"));
        process.exit(1);
      }
      console.log(colorize(`✓ Module installed at ${res.data.path}`, "green"));
      break;
    }
    case "uninstall":
    case "remove": {
      const mod = args[1];
      if (!mod) {
        console.error(colorize("Usage: bm2 module uninstall <name>", "red"));
        process.exit(1);
      }
      const res = await sendToDaemon({ type: "moduleUninstall", data: { module: mod } });
      if (!res.success) {
        console.error(colorize(`Error: ${res.error}`, "red"));
        process.exit(1);
      }
      console.log(colorize("✓ Module uninstalled", "green"));
      break;
    }
    case "list":
    case "ls": {
      const res = await sendToDaemon({ type: "moduleList" });
      if (!res.success) {
        console.error(colorize(`Error: ${res.error}`, "red"));
        process.exit(1);
      }
      if (res.data.length === 0) {
        console.log(colorize("No modules installed", "dim"));
      } else {
        for (const m of res.data) {
          console.log(`  ${colorize(m.name, "cyan")} @ ${m.version}`);
        }
      }
      break;
    }
    default:
      console.error(colorize("Usage: bm2 module <install|uninstall|list> ...", "red"));
      process.exit(1);
  }
}
