/**
 * BM2 — Bun Process Manager
 * A production-grade process manager for Bun.
 *
 * Features:
 * - Fork & cluster execution modes
 * - Auto-restart & crash recovery
 * - Health checks & monitoring
 * - Log management & rotation
 * - Deployment support
 *
 * https://github.com/your-org/bm2
 * License: GPL-3.0-only
 * Author: Zak <zak@maxxpainn.com>
 */

import type { Subprocess } from "bun";

export class LogStreamPiper {
  constructor(private appendLog: (filePath: string, data: string) => Promise<void>) {}

  pipeOutput(process: Subprocess, logPaths: { outFile: string; errFile: string }) {
    if (process.stdout && typeof process.stdout !== "number") {
      this.pipeStream(process.stdout, logPaths.outFile);
    }
    if (process.stderr && typeof process.stderr !== "number") {
      this.pipeStream(process.stderr, logPaths.errFile);
    }
  }

  async pipeStream(stream: ReadableStream<Uint8Array>, filePath: string) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let remainder = "";

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (remainder.length > 0) {
            const timestamp = new Date().toISOString();
            await this.appendLog(filePath, `[${timestamp}] ${remainder}\n`);
            remainder = "";
          }
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const text = remainder + chunk;
        const lines = text.split("\n");
        remainder = lines.pop()!;

        if (lines.length === 0) continue;

        const timestamp = new Date().toISOString();
        const output = lines.map((line) => `[${timestamp}] ${line}\n`).join("");
        await this.appendLog(filePath, output);
      }
    } catch (err) {
      if (remainder.length > 0) {
        const timestamp = new Date().toISOString();
        await this.appendLog(filePath, `[${timestamp}] ${remainder}\n`);
      }
      console.error("[bm2] Stream flush error:", err);
    }
  }
}
