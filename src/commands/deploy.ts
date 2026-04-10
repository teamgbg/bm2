import { colorize } from "../utils";
import { loadEcosystemConfig } from "../config-loader";
import { DeployManager } from "../deploy";

export async function cmdDeploy(args: string[]) {
  const configFile = args[0];
  const environment = args[1];

  if (!configFile || !environment) {
    console.error(colorize("Usage: bm2 deploy <config> <environment> [setup]", "red"));
    process.exit(1);
  }

  const config = await loadEcosystemConfig(configFile);
  
  if (!config.deploy || !config.deploy[environment]) {
    console.error(colorize(`Deploy environment "${environment}" not found in config`, "red"));
    process.exit(1);
  }

  const deployConfig = config.deploy[environment]!;
  const deployer = new DeployManager();

  if (args[2] === "setup") {
    await deployer.setup(deployConfig);
  } else {
    await deployer.deploy(deployConfig, args[2]);
  }
}
