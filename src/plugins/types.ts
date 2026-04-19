/**
 * @system bm2
 * @status handwritten
 * @edit edit directly

 * Plugin hook types for BM2 extensibility.
 */
import type { Subprocess } from "bun";
import type { ProcessDescription, ProcessState } from "../types";

export interface ProcessContainerHooks {
  onBeforeSpawn?: (
    config: ProcessDescription,
    cmd: string[],
    env: Record<string, string>
  ) => { cmd?: string[]; env?: Record<string, string> } | void;
  onAfterStart?: (container: any) => void | Promise<void>;
  onMetrics?: (
    metrics: { memory: number; cpu: number; handles: number },
    container: any
  ) => void;
  onPipeOutput?: (
    stream: ReadableStream<Uint8Array>,
    filePath: string,
    container: any
  ) => void | Promise<void>;
}

export interface ProcessManagerHooks {
  onAfterStop?: (container: any) => void | Promise<void>;
}

export interface DaemonHooks {
  onDaemonBoot?: (context: DaemonBootContext) => void | Promise<void>;
}

export interface DaemonBootContext {
  ecosystemPath: string | undefined;
}

export interface CLICommand {
  name: string;
  aliases?: string[];
  handler: (args: string[]) => Promise<void>;
  usage?: string;
  description?: string;
}