/**
 *
 * Failure surfacer — emits structured failure events when a service exhausts
 * its retry budget. Factory accepts dependencies via configure() per
 * configured-primitives; no direct imports on @teamgbg/core-logger or
 * @teamgbg/scala-agents-mcp.
 */

import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { BM2_HOME } from "./constants";

export interface FailureEvent {
  serviceSlug: string;
  exitCode: number | null;
  attemptCount: number;
  maxRestarts: number;
  elapsedMs: number;
  lastLogLines: string[];
  script: string | null;
  cwd: string | null;
}

export interface Logger {
  error(message: string, context: Record<string, unknown>): void;
}

export interface FleetTaskCreator {
  createTask(title: string, groupLabel: string): Promise<string | null>;
}

export interface FailureSurfacerDeps {
  logger?: Logger;
  fleetTaskCreator?: FleetTaskCreator;
  logReader?: (filePath: string, lineCount: number) => Promise<string[]>;
}

export interface FailureSurfacer {
  surface(event: FailureEvent): Promise<void>;
}

export function createFailureSurfacer(deps: FailureSurfacerDeps = {}): FailureSurfacer {
  const { logger, fleetTaskCreator, logReader } = deps;

  async function surface(event: FailureEvent): Promise<void> {
    const timestamp = new Date().toISOString();

    if (logger) {
      logger.error("bm2.max_restarts_exhausted", {
        timestamp,
        service: event.serviceSlug,
        exitCode: event.exitCode,
        attempts: event.attemptCount,
        maxRestarts: event.maxRestarts,
        elapsedMs: event.elapsedMs,
        lastLogLines: event.lastLogLines.slice(-50),
        script: event.script,
        cwd: event.cwd,
      });
    }

    const failuresLogPath = join(BM2_HOME, "failures.log");
    const line = `${timestamp} ERROR max_restarts_exhausted ${event.serviceSlug} attempts=${event.attemptCount}/${event.maxRestarts} exit=${event.exitCode ?? "?"} elapsedMs=${event.elapsedMs}\n`;
    try {
      await appendFile(failuresLogPath, line, "utf-8");
    } catch (err) {
      console.error(`[bm2-failure] could not append to failures.log: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (fleetTaskCreator) {
      try {
        const title = `Investigate ${event.serviceSlug} crash-loop (${event.attemptCount} attempts, exit=${event.exitCode ?? "?"})`;
        await fleetTaskCreator.createTask(title, "bm2-auto-remediation");
      } catch (err) {
        console.error(`[bm2-failure] fleet task creation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return { surface };
}
