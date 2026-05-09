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
 
import { homedir } from "os";
import { join } from "path";
import packageJson from '../package.json' assert { type: 'json' };


export const APP_NAME = packageJson.name;
export const VERSION = packageJson.version;

export const BM2_HOME = join(homedir(), ".bm2");
export const DAEMON_SOCKET = join(BM2_HOME, "daemon.sock");
export const DAEMON_PID_FILE = join(BM2_HOME, "daemon.pid");
export const DAEMON_OUT_LOG_FILE = join(BM2_HOME, "daemon.out.log");
export const DAEMON_ERR_LOG_FILE = join(BM2_HOME, "daemon.err.log");
export const LOG_DIR = join(BM2_HOME, "logs");
export const PID_DIR = join(BM2_HOME, "pids");
export const DUMP_FILE = join(BM2_HOME, "dump.json");
export const METRICS_DIR = join(BM2_HOME, "metrics");
export const MODULE_DIR = join(BM2_HOME, "modules");
export const CONFIG_FILE = join(BM2_HOME, "config.json");
export const DASHBOARD_PORT = 9615;
export const METRICS_PORT = 9616;

export const ALL_DIRS = [BM2_HOME, LOG_DIR, PID_DIR, METRICS_DIR, MODULE_DIR];

export const DEFAULT_KILL_TIMEOUT = 5000;
export const DEFAULT_MIN_UPTIME = 1000;
// Modern fail-fast default: try once, retry exactly twice for transient
// hiccups (port-in-use blip, DB connection race), then STOP and notify the
// operator. Silent endless retry is an anti-pattern — if a process fails
// reliably, the right action is to surface the failure, not loop on it.
// Per-service maxRestarts in service_env can override when a specific
// process genuinely benefits from more retries.
export const DEFAULT_MAX_RESTARTS = 3;
export const DEFAULT_RESTART_DELAY = 0;
export const DEFAULT_LOG_MAX_SIZE = 10 * 1024 * 1024; // 10MB
export const DEFAULT_LOG_RETAIN = 5;
export const MONITOR_INTERVAL = 1000;
export const HEALTH_CHECK_INTERVAL = 30000;
