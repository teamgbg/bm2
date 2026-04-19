/**
 * ProbeManager — manages render-probe state per process in bm2.
 * Coordinates with the service-probe watchdog (src/service-probe.ts).
 */

import type { ProcessContainer } from "./process-container";

export type ProbeState = "starting" | "ok" | "degraded" | "disabled";

export interface ProbeHealth {
  state: ProbeState;
  consecutiveFailures: number;
  lastProbe: string | null;
  error?: string;
}

export class ProbeManager {
  private probeStates: Map<string, ProbeHealth> = new Map();

  getProbeHealth(name: string): ProbeHealth | undefined {
    return this.probeStates.get(name);
  }

  updateProbeHealth(name: string, health: ProbeHealth): void {
    this.probeStates.set(name, health);
  }

  getProbeState(name: string): ProbeState | undefined {
    return this.probeStates.get(name)?.state;
  }

  onDisabled(slug: string): void {
    console.log(`[ProbeManager] ${slug}: process container notified of disabled state`);
  }

  syncFromContainer(container: ProcessContainer): void {
    if (!container.config.canonicalProbeUrl) return;
    const name = container.name;
    if (!this.probeStates.has(name)) {
      this.probeStates.set(name, {
        state: "starting",
        consecutiveFailures: 0,
        lastProbe: null,
      });
    }
  }

  getAllProbeStates(): Map<string, ProbeHealth> {
    return new Map(this.probeStates);
  }

  clear(): void {
    this.probeStates.clear();
  }
}