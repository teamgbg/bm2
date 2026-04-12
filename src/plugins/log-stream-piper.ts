/**
 * @system bm2
 * @status handwritten
 * @edit edit directly

 * Log streaming plugin - uses LogStreamPiper for buffered log output.
 */
import { pluginRegistry } from "./registry";
import { LogStreamPiper } from "../log-stream-piper";

export function createLogStreamPiper(
  appendLog: (filePath: string, data: string) => Promise<void>
): LogStreamPiper {
  return new LogStreamPiper(appendLog);
}

pluginRegistry.registerProcessContainerHooks({
  onPipeOutput: (stream, filePath, _container) => {
    // Note: The actual piping is handled via the LogStreamPiper class
    // which is instantiated in process-container.ts. This hook is here
    // for potential future enhancements like log filtering or routing.
  },
});