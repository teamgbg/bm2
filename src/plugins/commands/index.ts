/**
 * @system bm2
 * @status handwritten
 * @edit edit directly

 * Registers all custom CLI commands via the plugin registry.
 */
import { pluginRegistry } from "../registry";
import type { CLICommand } from "../types";

import { cmdDeploy } from "../../commands/deploy";
import { cmdStartup } from "../../commands/startup";
import { cmdEnv } from "../../commands/env";
import { cmdModule } from "../../commands/module";
import { cmdDaemon, cmdPing, cmdKill } from "../../commands/daemon";

const commands: CLICommand[] = [
  {
    name: "deploy",
    handler: cmdDeploy,
    usage: "bm2 deploy <config> <environment> [setup]",
    description: "Deploy using ecosystem config",
  },
  {
    name: "startup",
    handler: cmdStartup,
    usage: "bm2 startup [install|remove]",
    description: "Generate/install startup script",
  },
  {
    name: "env",
    handler: cmdEnv,
    usage: "bm2 env <set|get|delete|list> ...",
    description: "Manage environment variables",
  },
  {
    name: "module",
    handler: cmdModule,
    usage: "bm2 module <install|uninstall|list> ...",
    description: "Manage BM2 modules",
  },
  {
    name: "daemon",
    handler: cmdDaemon,
    usage: "bm2 daemon <reload>",
    description: "Manage the daemon",
  },
  {
    name: "ping",
    handler: cmdPing,
    description: "Check if daemon is alive",
  },
  {
    name: "kill",
    handler: cmdKill,
    description: "Kill the daemon and all processes",
  },
];

for (const cmd of commands) {
  pluginRegistry.registerCLICommand(cmd);
}