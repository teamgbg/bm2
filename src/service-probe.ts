/**
 * BM2 Service Render-Probe
 *
 * Mirrors the mcp-gateway watchdog pattern (mcp-gateway-durability.md)
 * for web services. State machine:
 *
 *   starting -> ok         (render probe succeeds on boot)
 *   starting -> degraded   (render probe fails on boot)
 *   ok -> degraded         (render probe fails during watchdog tick)
 *   degraded -> ok         (render probe recovers)
 *   degraded -> disabled   (3 consecutive failures -> DB is_active=false)
 *
 * Observability: emits service.probe.state_change and service.probe.boot
 * traces to loga. Per-service try/catch isolation.
 */

import { fetchRegistryEntry } from "../../infra-config/server/lib/registry-db.ts";
import postgres from "postgres";

const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;
const HEALTH_CHECK_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 15_000;

export type ProbeState = "starting" | "ok" | "degraded" | "disabled";

export interface ServiceProbeEntry {
  slug: string;
  public_hostname: string;
  canonical_probe_url: string;
  local_port: number;
}

export interface ProbeHealth {
  status: ProbeState;
  consecutiveFailures: number;
  lastProbe: string | null;
  toolCount?: number;
  error?: string;
}

interface ProbeCallbacks {
  getServiceProbeEntry: (slug: string) => ServiceProbeEntry | undefined;
  getProbeHealth: (slug: string) => ProbeHealth | undefined;
  updateProbeHealth: (slug: string, health: ProbeHealth) => void;
  onDisabled: (slug: string) => void;
}

let _callbacks: ProbeCallbacks | null = null;
let _watchdogTimer: ReturnType<typeof setInterval> | null = null;
let _bootProbeDone = false;

function emitStateTransition(
  slug: string,
  from: ProbeState,
  to: ProbeState,
  context?: Record<string, unknown>
): void {
  const LOGA_URL = process.env.LOGA_URL;
  if (!LOGA_URL) {
    console.warn(`[service-probe] LOGA_URL not set — trace not emitted`);
    return;
  }

  const trace = {
    traceId: `svc-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    rootSpanId: `svc-probe-${Date.now()}`,
    requestId: `svc-probe-${Date.now()}`,
    kind: "bm2",
    operation: "service.probe.state_change",
    spans: [
      {
        spanId: `svc-probe-${Date.now()}`,
        parentSpanId: null,
        operationName: "service.probe.state_change",
        startTime: Date.now(),
        durationMs: 0,
        status: to === "degraded" || to === "disabled" ? "warn" : "ok",
        attrs: {
          service: slug,
          from,
          to,
          ...(context || {}),
        },
      },
    ],
    startTime: Date.now(),
    durationMs: 0,
    status: to === "degraded" || to === "disabled" ? "warn" : "ok",
  };

  const queue: typeof trace[] = [trace];
  flushTraces(queue, LOGA_URL);
}

function emitBootTrace(slug: string, status: ProbeState, context?: Record<string, unknown>): void {
  const LOGA_URL = process.env.LOGA_URL;
  if (!LOGA_URL) return;

  const trace = {
    traceId: `svc-probe-boot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    rootSpanId: `svc-probe-${Date.now()}`,
    requestId: `svc-probe-${Date.now()}`,
    kind: "bm2",
    operation: "service.probe.boot",
    spans: [
      {
        spanId: `svc-probe-boot-${Date.now()}`,
        parentSpanId: null,
        operationName: "service.probe.boot",
        startTime: Date.now(),
        durationMs: 0,
        status: status === "ok" ? "ok" : "warn",
        attrs: {
          service: slug,
          status,
          ...(context || {}),
        },
      },
    ],
    startTime: Date.now(),
    durationMs: 0,
    status: status === "ok" ? "ok" : "warn",
  };

  const queue: typeof trace[] = [trace];
  flushTraces(queue, LOGA_URL);
}

async function flushTraces(traces: unknown[], LOGA_URL: string): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${LOGA_URL}/api/traces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(traces.map((t) => ({ trace: t }))),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`[service-probe] trace emit returned ${res.status}`);
    }
  } catch (err) {
    console.warn(`[service-probe] failed to emit trace: ${(err as Error).message}`);
  }
}

export function startServiceProbe(callbacks: ProbeCallbacks): () => void {
  _callbacks = callbacks;

  runBootProbe().catch((err) => {
    console.error(`[service-probe] boot probe error: ${err.message}`);
  });

  _watchdogTimer = setInterval(async () => {
    await runWatchdogTick().catch((err) => {
      console.error(`[service-probe] watchdog tick error: ${err.message}`);
    });
  }, WATCHDOG_INTERVAL_MS);

  _watchdogTimer.unref();

  console.log(
    `[service-probe] started — watchdog every ${WATCHDOG_INTERVAL_MS / 1000}s, auto-disable after ${MAX_CONSECUTIVE_FAILURES} failures`
  );

  return stopServiceProbe;
}

export function stopServiceProbe(): void {
  if (_watchdogTimer) {
    clearInterval(_watchdogTimer);
    _watchdogTimer = null;
  }
  _callbacks = null;
  _bootProbeDone = false;
}

async function runBootProbe(): Promise<void> {
  if (!_callbacks) return;
  const cbs = _callbacks;

  console.log(`[service-probe] running boot probe on all registered services...`);

  const services = listAllProbeServices();
  if (services.length === 0) {
    console.log(`[service-probe] no services with canonical_probe_url registered`);
    _bootProbeDone = true;
    return;
  }

  const results = await Promise.allSettled(
    services.map((svc) => runRenderProbe(svc.slug, svc.public_hostname, svc.canonical_probe_url))
  );

  for (let i = 0; i < services.length; i++) {
    const svc = services[i]!;
    const result = results[i]!;
    const current = cbs.getProbeHealth(svc.slug);

    if (result.status === "fulfilled") {
      const probeResult = result.value;
      if (probeResult.ok) {
        if (!current || current.status !== "ok") {
          cbs.updateProbeHealth(svc.slug, {
            status: "ok",
            consecutiveFailures: 0,
            lastProbe: new Date().toISOString(),
          });
          console.log(`[service-probe] ${svc.slug}: boot OK`);
          emitBootTrace(svc.slug, "ok", { type: "boot", url: svc.canonical_probe_url });
          emitStateTransition(svc.slug, (current?.status as ProbeState) || "starting", "ok", {
            type: "boot",
            url: svc.canonical_probe_url,
          });
        } else {
          cbs.updateProbeHealth(svc.slug, {
            ...current,
            lastProbe: new Date().toISOString(),
            consecutiveFailures: 0,
          });
        }
      } else {
        const prev = current?.status || "starting";
        cbs.updateProbeHealth(svc.slug, {
          status: "degraded",
          consecutiveFailures: 1,
          lastProbe: new Date().toISOString(),
          error: probeResult.error,
        });
        console.log(`[service-probe] ${svc.slug}: boot DEGRADED — ${probeResult.error}`);
        emitBootTrace(svc.slug, "degraded", { type: "boot", url: svc.canonical_probe_url, error: probeResult.error });
        emitStateTransition(svc.slug, prev as ProbeState, "degraded", {
          type: "boot",
          url: svc.canonical_probe_url,
          error: probeResult.error,
        });
      }
    } else {
      const err = result.reason;
      const prev = current?.status || "starting";
      cbs.updateProbeHealth(svc.slug, {
        status: "degraded",
        consecutiveFailures: 1,
        lastProbe: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      });
      console.log(`[service-probe] ${svc.slug}: boot DEGRADED — ${err instanceof Error ? err.message : String(err)}`);
      emitBootTrace(svc.slug, "degraded", { type: "boot", url: svc.canonical_probe_url, error: String(err) });
      emitStateTransition(svc.slug, prev as ProbeState, "degraded", {
        type: "boot",
        url: svc.canonical_probe_url,
        error: String(err),
      });
    }
  }

  _bootProbeDone = true;
}

async function runWatchdogTick(): Promise<void> {
  if (!_callbacks) return;
  if (!_bootProbeDone) {
    console.log(`[service-probe] skipping watchdog tick — boot probe still in progress`);
    return;
  }

  const cbs = _callbacks;
  const services = listAllProbeServices();

  for (const svc of services) {
    const current = cbs.getProbeHealth(svc.slug);
    if (!current) continue;
    if (current.status === "disabled") continue;

    try {
      const probeResult = await runRenderProbe(svc.slug, svc.public_hostname, svc.canonical_probe_url);

      if (probeResult.ok) {
        if (current.status !== "ok") {
          const prev = current.status;
          cbs.updateProbeHealth(svc.slug, {
            status: "ok",
            consecutiveFailures: 0,
            lastProbe: new Date().toISOString(),
            error: undefined,
          });
          console.log(`[service-probe] ${svc.slug}: recovered to OK`);
          emitStateTransition(svc.slug, prev, "ok", { type: "watchdog" });
        } else {
          cbs.updateProbeHealth(svc.slug, {
            ...current,
            consecutiveFailures: 0,
            lastProbe: new Date().toISOString(),
            error: undefined,
          });
        }
      } else {
        const newFailures = current.consecutiveFailures + 1;
        const prev = current.status;

        if (current.status === "ok") {
          cbs.updateProbeHealth(svc.slug, {
            status: "degraded",
            consecutiveFailures: newFailures,
            lastProbe: new Date().toISOString(),
            error: probeResult.error,
          });
          console.warn(`[service-probe] ${svc.slug}: DEGRADED — ${probeResult.error} (failure ${newFailures}/${MAX_CONSECUTIVE_FAILURES})`);
          emitStateTransition(svc.slug, "ok", "degraded", { type: "watchdog", error: probeResult.error });
        } else {
          cbs.updateProbeHealth(svc.slug, {
            ...current,
            consecutiveFailures: newFailures,
            lastProbe: new Date().toISOString(),
            error: probeResult.error,
          });
          console.warn(`[service-probe] ${svc.slug}: still degraded (failure ${newFailures}/${MAX_CONSECUTIVE_FAILURES})`);

          if (newFailures >= MAX_CONSECUTIVE_FAILURES) {
            cbs.updateProbeHealth(svc.slug, {
              status: "disabled",
              consecutiveFailures: newFailures,
              lastProbe: new Date().toISOString(),
              error: probeResult.error,
            });
            console.error(`[service-probe] ${svc.slug}: AUTO-DISABLED after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`);
            emitStateTransition(svc.slug, "degraded", "disabled", { type: "watchdog", consecutiveFailures: newFailures });
            await disableServiceInDB(svc.slug);
            cbs.onDisabled(svc.slug);
          }
        }
      }
    } catch (err) {
      const newFailures = current.consecutiveFailures + 1;
      const prev = current.status;
      const errMsg = err instanceof Error ? err.message : String(err);

      cbs.updateProbeHealth(svc.slug, {
        status: current.status === "ok" ? "degraded" : current.status,
        consecutiveFailures: newFailures,
        lastProbe: new Date().toISOString(),
        error: errMsg,
      });
      console.error(`[service-probe] ${svc.slug}: probe error — ${errMsg} (failure ${newFailures}/${MAX_CONSECUTIVE_FAILURES})`);
      emitStateTransition(svc.slug, prev as ProbeState, current.status === "ok" ? "degraded" : prev as ProbeState, {
        type: "watchdog",
        error: errMsg,
      });

      if (newFailures >= MAX_CONSECUTIVE_FAILURES) {
        cbs.updateProbeHealth(svc.slug, {
          status: "disabled",
          consecutiveFailures: newFailures,
          lastProbe: new Date().toISOString(),
          error: errMsg,
        });
        console.error(`[service-probe] ${svc.slug}: AUTO-DISABLED after ${MAX_CONSECUTIVE_FAILURES} consecutive probe errors`);
        emitStateTransition(svc.slug, "degraded", "disabled", { type: "watchdog", consecutiveFailures: newFailures });
        await disableServiceInDB(svc.slug);
        cbs.onDisabled(svc.slug);
      }
    }
  }
}

interface ProbeResult {
  ok: boolean;
  error?: string;
}

async function runRenderProbe(
  slug: string,
  public_hostname: string,
  canonical_probe_url: string
): Promise<ProbeResult> {
  const baseUrl = `https://${public_hostname}`;
  const probeUrl = `${baseUrl}${canonical_probe_url}`;

  const controller = new AbortController();
  const probeTimeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(probeUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "bm2-service-probe/1.0",
        "Accept": "text/html",
      },
    });

    clearTimeout(probeTimeout);

    if (!res.ok) {
      return { ok: false, error: `probe URL returned HTTP ${res.status}` };
    }

    const html = await res.text();

    if (!html.includes("id=\"__page\"")) {
      return { ok: false, error: "SSR output missing #__page element" };
    }

    const pageMatch = html.match(/id="__page"[^>]*>([\s\S]*?)<\/div>/);
    const pageContent = pageMatch?.[1] || "";
    if (pageContent.trim().length === 0) {
      return { ok: false, error: "#__page has zero children — SSR produced empty content" };
    }

    const stylesheetLinks = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)];
    for (const match of stylesheetLinks) {
      const href = match[1] ?? "";
      if (!href || href.startsWith("data:")) continue;

      const cssController = new AbortController();
      const cssTimeout = setTimeout(() => cssController.abort(), HEALTH_CHECK_TIMEOUT_MS);

      try {
        const cssUrl = href.startsWith("http") ? href : `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
        const cssRes = await fetch(cssUrl, { signal: cssController.signal });
        clearTimeout(cssTimeout);

        if (!cssRes.ok) {
          return { ok: false, error: `stylesheet ${cssUrl} returned HTTP ${cssRes.status}` };
        }

        const cssBody = await cssRes.text();
        if (cssBody.length <= 200) {
          return { ok: false, error: `stylesheet ${cssUrl} body=${cssBody.length} bytes — likely 404` };
        }
      } catch (cssErr) {
        clearTimeout(cssTimeout);
        const cssErrMsg = cssErr instanceof Error ? cssErr.message : String(cssErr);
        const cssFailedUrl = href.startsWith("http") ? href : `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
        return { ok: false, error: `stylesheet fetch failed for ${cssFailedUrl}: ${cssErrMsg}` };
      }
    }

    const hydrationErrorCodes = ["#418", "#419", "#422", "#425"];
    const scriptBlocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const match of scriptBlocks) {
      const scriptContent = match[1] || "";
      for (const code of hydrationErrorCodes) {
        if (scriptContent.includes(code)) {
          return { ok: false, error: `hydration error code ${code} found in inline script` };
        }
      }
    }

    return { ok: true };
  } catch (err) {
    clearTimeout(probeTimeout);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function disableServiceInDB(slug: string): Promise<void> {
  const DATABASE_URL = process.env.DATABASE_URL
    || (() => {
      try {
        const { readFileSync } = require("node:fs");
        const { join } = require("node:path");
        const { homedir } = require("node:os");
        const content = readFileSync(join(homedir(), ".config", "scala", "bootstrap.env"), "utf-8");
        const match = content.match(/^DATABASE_URL=(.+)$/m);
        return match?.[1]?.trim() || null;
      } catch {
        return null;
      }
    })();

  if (!DATABASE_URL) {
    console.error(`[service-probe] cannot disable ${slug} in DB — DATABASE_URL not set`);
    return;
  }

  try {
    const sql = postgres(DATABASE_URL, { ssl: "require", max: 1, idle_timeout: 10, connect_timeout: 10, prepare: false });
    const result = await sql`UPDATE registry_entries SET is_active = false WHERE type = 'service_routing' AND slug = ${slug} RETURNING id`;
    await sql.end();
    if (result.length > 0) {
      console.log(`[service-probe] ${slug}: is_active=false written to database`);
    }
  } catch (err) {
    console.error(`[service-probe] ${slug}: failed to disable in database: ${(err as Error).message}`);
  }
}

function listAllProbeServices(): ServiceProbeEntry[] {
  return [];
}

export async function loadProbeServicesFromDB(): Promise<ServiceProbeEntry[]> {
  const entry = await fetchRegistryEntry("service_routing", "probe-services-manifest");
  if (!entry) return [];

  const config = entry.config as { services?: ServiceProbeEntry[] };
  return config.services || [];
}

async function syncProbeServicesFromRegistry(): Promise<ServiceProbeEntry[]> {
  const { fetchRegistryEntries } = await import("../../infra-config/server/lib/registry-db.ts");
  const rows = await fetchRegistryEntries("service_routing");
  return rows
    .filter((r) => {
      const cfg = r.config as Record<string, unknown>;
      return cfg.local_port && cfg.canonical_probe_url && cfg.public_hostname;
    })
    .map((r) => {
      const cfg = r.config as Record<string, unknown>;
      return {
        slug: r.slug,
        public_hostname: cfg.public_hostname as string,
        canonical_probe_url: cfg.canonical_probe_url as string,
        local_port: cfg.local_port as number,
      };
    });
}

export { syncProbeServicesFromRegistry as syncProbeServicesFromRegistry };