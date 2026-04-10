import type { ProcessState } from "./types";
import { ProcessContainer } from "./process-container";
import { DUMP_FILE } from "./utils";

export async function save(registry: { values(): ProcessContainer[] }): Promise<void> {
  const seen = new Map<string, { config: any; restartCount: number }>();
  for (const p of registry.values()) {
    seen.set(p.config.name, { config: p.config, restartCount: p.restartCount });
  }
  const data = Array.from(seen.values());
  await Bun.write(DUMP_FILE, JSON.stringify(data, null, 2));
}

export async function resurrect(
  registry: { values(): ProcessContainer[] },
  start: (options: any) => Promise<ProcessState[]>
): Promise<ProcessState[]> {
  try {
    const file = Bun.file(DUMP_FILE);
    if (!(await file.exists())) return [];
    const data = await file.json();
    const states: ProcessState[] = [];

    for (const item of data) {
      const result = await start({
        name: item.config.name,
        script: item.config.script,
        args: item.config.args,
        cwd: item.config.cwd,
        env: item.config.env,
        autorestart: item.config.autorestart,
        maxRestarts: item.config.maxRestarts,
        watch: item.config.watch,
        instances: 1,
        execMode: item.config.execMode,
        port: item.config.port,
        healthCheckUrl: item.config.healthCheckUrl,
      });
      states.push(...result);
    }
    return states;
  } catch {
    return [];
  }
}
