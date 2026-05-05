#!/usr/bin/env bun
/**
 * @system bm2
 * @status handwritten
 * @edit edit directly
 *
 * Boot script for WSL2 startup. Reads the ecosystem config (generated from
 * registry rows), installs dependencies in every service directory, then
 * starts BM2 with the ecosystem file.
 *
 * Usage: bun run boot.ts [--mode development|production]
 *
 * --mode overrides the BM2_MODE env var (default: development).
 * In development, services run with Vite HMR.
 * In production, services run built assets with NODE_ENV=production.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

const ECOSYSTEM_PATH =
  process.env.BM2_ECOSYSTEM ||
  join(import.meta.dir, "..", "infra-config", "ecosystem.bm2.local.json");

async function run(cmd: string, args: string[], cwd: string) {
  const proc = Bun.spawn([cmd, ...args], { cwd, stdout: "inherit", stderr: "inherit" });
  const exit = await proc.exited;
  if (exit !== 0) {
    console.error(`[boot] ${cmd} ${args.join(" ")} failed (exit ${exit}) in ${cwd}`);
  }
  return exit;
}

async function boot() {
  const mode = process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1]
    || process.env.BM2_MODE
    || "development";

  console.log(`[boot] mode=${mode}`);
  console.log(`[boot] generating ecosystem from database...`);

  const codegenExit = await run("scala-tools", [
    "codegen", "run", "--output", "ecosystem",
  ], join(import.meta.dir, ".."));

  if (codegenExit !== 0) {
    console.error("[boot] codegen failed, aborting");
    process.exit(1);
  }

  if (!existsSync(ECOSYSTEM_PATH)) {
    console.error(`[boot] ecosystem not found at ${ECOSYSTEM_PATH}`);
    process.exit(1);
  }

  const ecosystem = JSON.parse(readFileSync(ECOSYSTEM_PATH, "utf-8"));
  const apps = ecosystem.apps as Array<{ name: string; cwd: string }>;

  console.log(`[boot] installing dependencies for ${apps.length} services...`);

  for (const app of apps) {
    if (!app.cwd || !existsSync(join(app.cwd, "package.json"))) continue;
    console.log(`[boot]   ${app.name} (${app.cwd})`);
    await run("bun", ["install", "--frozen-lockfile"], app.cwd);
  }

  console.log(`[boot] starting BM2...`);
  const bm2Exit = await run("bm2", ["start", ECOSYSTEM_PATH], join(import.meta.dir, ".."));

  if (bm2Exit !== 0) {
    console.error("[boot] BM2 start failed");
    process.exit(1);
  }

  console.log(`[boot] done — ${apps.length} services started in ${mode} mode`);
}

boot().catch((err) => {
  console.error("[boot] fatal:", err);
  process.exit(1);
});
