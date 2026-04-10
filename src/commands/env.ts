import { colorize } from "../utils";
import { EnvManager } from "../env-manager";

export async function cmdEnv(args: string[]) {
  const envMgr = new EnvManager();
  const subCmd = args[0];

  switch (subCmd) {
    case "set": {
      const name = args[1];
      const key = args[2];
      const value = args[3];
      if (!name || !key || value === undefined) {
        console.error(colorize("Usage: bm2 env set <name> <key> <value>", "red"));
        process.exit(1);
      }
      await envMgr.setEnv(name, key, value);
      console.log(colorize(`✓ Set ${key}=${value} for ${name}`, "green"));
      break;
    }
    case "get": {
      const name = args[1];
      if (!name) {
        console.error(colorize("Usage: bm2 env get <name>", "red"));
        process.exit(1);
      }
      const env = await envMgr.getEnv(name);
      for (const [k, v] of Object.entries(env)) {
        console.log(`${colorize(k, "cyan")}=${v}`);
      }
      break;
    }
    case "delete":
    case "rm": {
      const name = args[1];
      const key = args[2];
      if (!name) {
        console.error(colorize("Usage: bm2 env delete <name> [key]", "red"));
        process.exit(1);
      }
      await envMgr.deleteEnv(name, key);
      console.log(colorize(`✓ Deleted`, "green"));
      break;
    }
    case "list": {
      const all = await envMgr.getEnvs();
      for (const [name, env] of Object.entries(all)) {
        console.log(colorize(`\n${name}:`, "bold"));
        for (const [k, v] of Object.entries(env)) {
          console.log(`  ${colorize(k, "cyan")}=${v}`);
        }
      }
      break;
    }
    default:
      console.error(colorize("Usage: bm2 env <set|get|delete|list> ...", "red"));
      process.exit(1);
  }
}
