import { StartupManager } from "../startup-manager";

export async function cmdStartup(args: string[]) {
  const startup = new StartupManager();

  if (args[0] === "remove" || args[0] === "uninstall") {
    const result = await startup.uninstall();
    console.log(result);
    return;
  }

  if (args[0] === "install") {
    const result = await startup.install();
    console.log(result);
    return;
  }

  const content = await startup.generate(args[0]);
  console.log(content);
}
