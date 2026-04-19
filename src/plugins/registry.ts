/**
 * @system bm2
 * @status handwritten
 * @edit edit directly

 * Singleton registry for BM2 plugins.
 */
import type { ProcessContainerHooks, ProcessManagerHooks, CLICommand, DaemonHooks } from "./types";

class BM2PluginRegistry {
  private processContainerHooks: ProcessContainerHooks[] = [];
  private processManagerHooks: ProcessManagerHooks[] = [];
  private daemonHooks: DaemonHooks[] = [];
  private cliCommands: CLICommand[] = [];

  registerProcessContainerHooks(hooks: ProcessContainerHooks) {
    this.processContainerHooks.push(hooks);
  }

  registerProcessManagerHooks(hooks: ProcessManagerHooks) {
    this.processManagerHooks.push(hooks);
  }

  registerDaemonHooks(hooks: DaemonHooks) {
    this.daemonHooks.push(hooks);
  }

  registerCLICommand(command: CLICommand) {
    this.cliCommands.push(command);
  }

  getProcessContainerHooks(): ProcessContainerHooks[] {
    return this.processContainerHooks;
  }

  getProcessManagerHooks(): ProcessManagerHooks[] {
    return this.processManagerHooks;
  }

  getDaemonHooks(): DaemonHooks[] {
    return this.daemonHooks;
  }

  getCLICommands(): CLICommand[] {
    return this.cliCommands;
  }
}

export const pluginRegistry = new BM2PluginRegistry();