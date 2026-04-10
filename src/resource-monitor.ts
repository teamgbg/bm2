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

import pidusage from "pidusage";
import { readdir } from "node:fs/promises";
import { MONITOR_INTERVAL } from "./constants";

export class ResourceMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;
  private memory = 0;
  private cpu = 0;
  private handles = 0;

  start(
    pid: number,
    maxMemoryRestart: number | undefined,
    onStats: (memory: number, cpu: number, handles: number) => void,
    onMemoryExceeded: () => Promise<void>
  ) {
    this.stop();
    this.interval = setInterval(async () => {
      try {
        const stats = await pidusage(pid);
        this.memory = stats.memory;
        this.cpu = stats.cpu;

        if (process.platform === "linux") {
          try {
            this.handles = (await readdir(`/proc/${pid}/fd`)).length;
          } catch {}
        }

        onStats(this.memory, this.cpu, this.handles);

        if (maxMemoryRestart && this.memory > maxMemoryRestart) {
          console.log(`[bm2] Process exceeded memory limit (${this.memory} > ${maxMemoryRestart}), restarting...`);
          await onMemoryExceeded();
        }
      } catch {}
    }, MONITOR_INTERVAL);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
