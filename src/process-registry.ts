import type { ProcessState } from "./types";
import { ProcessContainer } from "./process-container";

export class ProcessRegistry {
  private processes: Map<number, ProcessContainer> = new Map();
  private _nextId: number = 0;

  allocateId(): number {
    return this._nextId++;
  }

  add(container: ProcessContainer): void {
    this.processes.set(container.id, container);
  }

  delete(id: number): void {
    this.processes.delete(id);
  }

  clear(): void {
    this.processes.clear();
    this._nextId = 0;
  }

  get(id: number): ProcessContainer | undefined {
    return this.processes.get(id);
  }

  values(): ProcessContainer[] {
    return Array.from(this.processes.values());
  }

  resolveTarget(target: string | number): ProcessContainer[] {
    if (target === "all") {
      return this.values();
    }

    if (typeof target === "number" || /^\d+$/.test(String(target))) {
      const id = typeof target === "number" ? target : parseInt(target);
      const proc = this.processes.get(id);
      return proc ? [proc] : [];
    }

    return this.values().filter(
      (p) =>
        p.name === target ||
        p.name.startsWith(`${target}-`) ||
        p.config.namespace === target
    );
  }

  list(): ProcessState[] {
    return this.values().map((p) => p.getState());
  }

  describe(target: string | number): ProcessState[] {
    return this.resolveTarget(target).map((p) => p.getState());
  }

  get nextId(): number {
    return this._nextId;
  }
}
