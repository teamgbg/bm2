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
import type {
  ProcessDescription,
  ProcessState,
  StartOptions,
  EcosystemConfig,
  MetricSnapshot,
} from "./types";
import { ProcessContainer } from "./process-container";
import { ProcessRegistry } from "./process-registry";
import { save, resurrect } from "./process-persistence";
import { LogManager } from "./log-manager";
import { ClusterManager } from "./cluster-manager";
import { HealthChecker } from "./health-checker";
import { CronManager } from "./cron-manager";
import { Monitor } from "./monitor";
import { GracefulReload } from "./graceful-reload";
import { parseMemory } from "./utils";
import {
  DEFAULT_KILL_TIMEOUT,
  DEFAULT_MAX_RESTARTS,
  DEFAULT_MIN_UPTIME,
  DEFAULT_RESTART_DELAY,
  DEFAULT_LOG_MAX_SIZE,
  DEFAULT_LOG_RETAIN,
} from "./constants";
import path from "path";
import { pluginRegistry } from "./plugins/registry";

export class ProcessManager {
  public logManager: LogManager;
  public clusterManager: ClusterManager;
  public healthChecker: HealthChecker;
  public cronManager: CronManager;
  public monitor: Monitor;
  public gracefulReload: GracefulReload;
  public registry: ProcessRegistry;

  constructor() {
    this.logManager = new LogManager();
    this.clusterManager = new ClusterManager();
    this.healthChecker = new HealthChecker();
    this.cronManager = new CronManager();
    this.monitor = new Monitor();
    this.gracefulReload = new GracefulReload();
    this.registry = new ProcessRegistry();
  }

  async start(options: StartOptions): Promise<ProcessState[]> {
    if (options.name) {
      const existing = this.registry.values().filter(
        (p) => p.getState().name === options.name
      );
      for (const container of existing) {
        const state = container.getState();
        if (state.status !== "stopped") {
          await container.stop(true);
        }
        console.error(`[bm2] Removing duplicate "${options.name}" (id=${container.id}) before starting new instance`);
        this.registry.delete(container.id);
      }
    }

    const resolvedInstances = this.clusterManager.resolveInstances(options.instances);
    const isCluster = options.execMode === "cluster" || resolvedInstances > 1;
    const states: ProcessState[] = [];

    options.script = path.isAbsolute(options.script)
      ? options.script
      : path.join(options.cwd!, options.script);

    if (!(await Bun.file(options.script).exists())) {
      throw new Error(`Script not found: ${options.script}`);
    }

    if (isCluster) {
      for (let i = 0; i < resolvedInstances; i++) {
        const id = this.registry.allocateId();
        const baseName = options.name || options.script.split("/").pop()?.replace(/\.\w+$/, "") || `app-${id}`;
        const name = resolvedInstances > 1 ? `${baseName}-${i}` : baseName;

        const config = this.buildConfig(id, name, options, resolvedInstances, i);

        const container = new ProcessContainer(
          id,
          config,
          this.logManager,
          this.clusterManager,
          this.healthChecker,
          this.cronManager
        );

        this.registry.add(container);
        await container.start();
        states.push(container.getState());
      }
    } else {
      const id = this.registry.allocateId();
      const name =
          options.name ||
          options.script.split("/").pop()?.replace(/\.\w+$/, "") ||
          `app-${id}`;

      const config = this.buildConfig(id, name, options, 1, 0);
      const container = new ProcessContainer(
        id, config,
        this.logManager,
        this.clusterManager,
        this.healthChecker,
        this.cronManager
      );

      this.registry.add(container);
      await container.start();
      states.push(container.getState());
    }

    return states;
  }

  private buildConfig(
    id: number,
    name: string,
    options: StartOptions,
    instances: number,
    workerIndex: number
  ): ProcessDescription {
    return {
      id,
      name,
      script: options.script,
      args: options.args || [],
      cwd: options.cwd || process.cwd(),
      env: {
        ...options.env,
        ...(instances > 1
          ? {
              NODE_APP_INSTANCE: String(workerIndex),
              BM2_INSTANCE_ID: String(workerIndex),
            }
          : {}),
      },
      instances,
      execMode: instances > 1 ? "cluster" : (options.execMode || "fork"),
      autorestart: options.autorestart !== false,
      maxRestarts: options.maxRestarts ?? DEFAULT_MAX_RESTARTS,
      minUptime: options.minUptime ?? DEFAULT_MIN_UPTIME,
      maxMemoryRestart: options.maxMemoryRestart
        ? parseMemory(options.maxMemoryRestart)
        : undefined,
      watch: Array.isArray(options.watch) ? true : (options.watch ?? false),
      watchPaths: Array.isArray(options.watch) ? options.watch : undefined,
      ignoreWatch: options.ignoreWatch || ["node_modules", ".git", ".bm2"],
      cronRestart: options.cron,
      interpreter: options.interpreter,
      interpreterArgs: options.interpreterArgs,
      mergeLogs: options.mergeLogs ?? false,
      logDateFormat: options.logDateFormat,
      errorFile: options.errorFile,
      outFile: options.outFile,
      killTimeout: options.killTimeout ?? DEFAULT_KILL_TIMEOUT,
      restartDelay: options.restartDelay ?? DEFAULT_RESTART_DELAY,
      port: options.port,
      healthCheckUrl: options.healthCheckUrl,
      healthCheckInterval: options.healthCheckInterval,
      healthCheckTimeout: options.healthCheckTimeout,
      healthCheckMaxFails: options.healthCheckMaxFails,
      logMaxSize: options.logMaxSize ? parseMemory(options.logMaxSize) : DEFAULT_LOG_MAX_SIZE,
      logRetain: options.logRetain ?? DEFAULT_LOG_RETAIN,
      logCompress: options.logCompress,
      waitReady: options.waitReady,
      listenTimeout: options.listenTimeout,
      namespace: options.namespace,
      nodeArgs: options.nodeArgs,
      sourceMapSupport: options.sourceMapSupport,
      treekill: true,
      protected: options.protected,
    };
  }

  async stop(target: string | number): Promise<ProcessState[]> {
    const containers = this.registry.resolveTarget(target);
    const states: ProcessState[] = [];
    for (const c of containers) {
      await c.stop();
      states.push(c.getState());
    }
    return states;
  }

  async restart(target: string | number): Promise<ProcessState[]> {
    const containers = this.registry.resolveTarget(target);
    const states: ProcessState[] = [];
    for (const c of containers) {
      await c.restart();
      states.push(c.getState());
    }
    return states;
  }

  async reload(target: string | number): Promise<ProcessState[]> {
    const containers = this.registry.resolveTarget(target);
    await this.gracefulReload.reload(containers);
    return containers.map((c) => c.getState());
  }

  async del(target: string | number): Promise<ProcessState[]> {
    const containers = this.registry.resolveTarget(target);
    const states: ProcessState[] = [];
    for (const c of containers) {
      await c.stop(true);
      states.push(c.getState());
      this.registry.delete(c.id);
    }
    return states;
  }

  async stopAll(): Promise<ProcessState[]> {
    const states: ProcessState[] = [];
    for (const c of this.registry.values()) {
      await c.stop();
      states.push(c.getState());
    }
    return states;
  }

  async restartAll(): Promise<ProcessState[]> {
    const states: ProcessState[] = [];
    for (const c of this.registry.values()) {
      await c.restart();
      states.push(c.getState());
    }
    return states;
  }

  async reloadAll(): Promise<ProcessState[]> {
    const containers = this.registry.values();
    await this.gracefulReload.reload(containers);
    return containers.map((c) => c.getState());
  }

  async deleteAll(): Promise<ProcessState[]> {
    const states: ProcessState[] = [];
    for (const c of this.registry.values()) {
      await c.stop(true);
      await Bun.sleep(100);
      states.push(c.getState());
    }
    this.registry.clear();
    return states;
  }

  async scale(target: string | number, count: number): Promise<ProcessState[]> {
    const containers = this.registry.resolveTarget(target);
    if (containers.length === 0) return [];

    const first = containers[0]!;
    const baseName = first.name.replace(/-\d+$/, "");
    const currentCount = containers.length;

    if (count > currentCount) {
      const toAdd = count - currentCount;
      const baseConfig = first.config;
      const states: ProcessState[] = [];

      for (let i = 0; i < toAdd; i++) {
        const result = await this.start({
          name: `${baseName}-${currentCount + i}`,
          script: baseConfig.script,
          args: baseConfig.args,
          cwd: baseConfig.cwd,
          env: baseConfig.env,
          execMode: baseConfig.execMode,
          autorestart: baseConfig.autorestart,
          maxRestarts: baseConfig.maxRestarts,
          watch: baseConfig.watch,
          port: baseConfig.port,
        });
        states.push(...result);
      }

      return [...containers.map((c) => c.getState()), ...states];
    } else if (count < currentCount) {
      const toRemove = containers.slice(count);
      for (const c of toRemove) {
        await c.stop(true);
        this.registry.delete(c.id);
      }
      return containers.slice(0, count).map((c) => c.getState());
    }

    return containers.map((c) => c.getState());
  }

  list(): ProcessState[] {
    return this.registry.list();
  }

  describe(target: string | number): ProcessState[] {
    return this.registry.describe(target);
  }

  async getLogs(target: string | number, lines: number = 20) {
    const containers = this.registry.resolveTarget(target);
    const results: Array<{ name: string; id: number; out: string; err: string }> = [];
    for (const c of containers) {
      const logs = await this.logManager.readLogs(
        c.name, c.id, lines, c.config.outFile, c.config.errorFile
      );
      results.push({ name: c.name, id: c.id, ...logs });
    }
    return results;
  }

  async flushLogs(target?: string | number) {
    const containers = target
      ? this.registry.resolveTarget(target)
      : this.registry.values();
    for (const c of containers) {
      await this.logManager.flush(c.name, c.id, c.config.outFile, c.config.errorFile);
    }
  }

  async save(): Promise<void> {
    return save(this.registry);
  }

  async resurrect(): Promise<ProcessState[]> {
    return resurrect(this.registry, (opts) => this.start(opts));
  }

  async startEcosystem(config: EcosystemConfig): Promise<ProcessState[]> {
    const states: ProcessState[] = [];
    for (const app of config.apps) {
      const result = await this.start(app);
      states.push(...result);
    }
    return states;
  }

  async sendSignal(target: string | number, signal: string): Promise<void> {
    for (const c of this.registry.resolveTarget(target)) {
      await c.sendSignal(signal);
    }
  }

  async getMetrics(): Promise<MetricSnapshot> {
    return this.monitor.takeSnapshot(this.list());
  }

  getPrometheusMetrics(): string {
    return this.monitor.generatePrometheusMetrics(this.list());
  }

  getMetricsHistory(seconds: number = 300): MetricSnapshot[] {
    return this.monitor.getHistory(seconds);
  }

  async reset(target: string | number): Promise<ProcessState[]> {
    const containers = this.registry.resolveTarget(target);
    for (const c of containers) {
      c.restartCount = 0;
      c.unstableRestarts = 0;
    }
    return containers.map((c) => c.getState());
  }
}