/**
 * @system bm2
 * @status handwritten
 * @edit edit directly

 * Singleton registry for BM2 plugins.
 */
import type { ProcessContainerHooks, ProcessManagerHooks, CLICommand } from "./types";

class BM2PluginRegistry {
  private processContainerHooks: ProcessContainerHooks[] = [];
  private processManagerHooks: ProcessManagerHooks[] = [];
  private cliCommands: CLICommand[] = [];

  registerProcessContainerHooks(hooks: ProcessContainerHooks) {
    this.processContainerHooks.push(hooks);
  }

  registerProcessManagerHooks(hooks: ProcessManagerHooks) {
    this.processManagerHooks.push(hooks);
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

  getCLICommands(): CLICommand[] {
    return this.cliCommands;
  }
}

export const pluginRegistry = new BM2PluginRegistry();