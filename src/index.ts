#!/usr/bin/env bun
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

import { APP_NAME, VERSION } from "./constants";
import { ensureDirs, colorize } from "./utils";
import { printHelp } from "./help";
import { cmdStart, cmdStop, cmdRestart, cmdReload, cmdDelete, cmdList, cmdDescribe, cmdScale, cmdReset, cmdSignal } from "./commands/process";
import { cmdLogs, cmdFlush } from "./commands/logs";
import { cmdMonit, cmdDashboard, cmdDashboardStop, cmdPrometheus } from "./commands/monitoring";
import { cmdSave, cmdResurrect } from "./commands/persistence";
import { cmdDeploy } from "./commands/deploy";
import { cmdStartup } from "./commands/startup";
import { cmdEnv } from "./commands/env";
import { cmdModule } from "./commands/module";
import { cmdPing, cmdKill, cmdDaemon } from "./commands/daemon";

ensureDirs();

const args = process.argv.slice(2);
const command = args[0];
const commandArgs = args.slice(1);

switch (command) {
case "start":
    await cmdStart(commandArgs);
    break;
case "stop":
    await cmdStop(commandArgs);
    break;
case "restart":
    await cmdRestart(commandArgs);
    break;
case "reload":
    await cmdReload(commandArgs);
    break;
case "delete":
case "del":
case "rm":
    await cmdDelete(commandArgs);
    break;
case "scale":
    await cmdScale(commandArgs);
    break;
case "list":
case "ls":
case "status":
    await cmdList(commandArgs);
    break;
case "describe":
case "show":
case "info":
    await cmdDescribe(commandArgs);
    break;
case "logs":
case "log":
    await cmdLogs(commandArgs);
    break;
case "flush":
    await cmdFlush(commandArgs);
    break;
case "monit":
case "monitor":
    await cmdMonit();
    break;
case "dashboard":
    if (commandArgs[0] === "stop") {
    await cmdDashboardStop();
    } else {
    await cmdDashboard(commandArgs);
    }
    break;
case "prometheus":
    await cmdPrometheus();
    break;
case "save":
case "dump":
    await cmdSave();
    break;
case "resurrect":
case "restore":
    await cmdResurrect();
    break;
case "reset":
    await cmdReset(commandArgs);
    break;
case "sendSignal":
case "signal":
    await cmdSignal(commandArgs);
    break;
case "ping":
    await cmdPing();
    break;
case "kill":
    await cmdKill();
    break;
case "deploy":
    await cmdDeploy(commandArgs);
    break;
case "startup":
    await cmdStartup(commandArgs);
    break;
case "env":
    await cmdEnv(commandArgs);
    break;
case "module":
    await cmdModule(commandArgs);
    break;
case "daemon":
    await cmdDaemon(commandArgs);
    break;
case "version":
case "-v":
case "--version":
    console.log(`${APP_NAME} v${VERSION}`);
    break;
case "help":
case "-h":
case "--help":
case undefined:
    printHelp();
    break;
default:
    console.error(colorize(`Unknown command: ${command}`, "red"));
    console.error(`Run ${colorize("bm2 --help", "cyan")} for usage information.`);
    process.exit(1);
}
