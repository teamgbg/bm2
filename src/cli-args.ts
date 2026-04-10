import type { StartOptions } from "./types";

export function parseStartFlags(args: string[], scriptOrConfig: string): StartOptions {
  const opts: StartOptions = { script: scriptOrConfig };

  let i = 0;
  const positionalArgs: string[] = [];

  while (i < args.length) {
    const arg = args[i]!;

    switch (arg) {
      case "--name":
      case "-n":
        opts.name = args[++i];
        break;
      case "--instances":
      case "-i":
        opts.instances = parseInt(args[++i]!) || 1;
        break;
      case "--cwd":
        opts.cwd = args[++i];
        break;
      case "--interpreter":
        opts.interpreter = args[++i];
        break;
      case "--interpreter-args":
        opts.interpreterArgs = args[++i]!.split(" ");
        break;
      case "--node-args":
        opts.nodeArgs = args[++i]!.split(" ");
        break;
      case "--watch":
      case "-w":
        opts.watch = true;
        break;
      case "--watch-path":
        if (!Array.isArray(opts.watch)) opts.watch = [];
        (opts.watch as string[]).push(args[++i]!);
        break;
      case "--ignore-watch":
        opts.ignoreWatch = args[++i]!.split(",");
        break;
      case "--exec-mode":
      case "-x":
        opts.execMode = args[++i] as "fork" | "cluster";
        break;
      case "--max-memory-restart":
        opts.maxMemoryRestart = args[++i];
        break;
      case "--max-restarts":
        opts.maxRestarts = parseInt(args[++i]!);
        break;
      case "--min-uptime":
        opts.minUptime = parseInt(args[++i]!);
        break;
      case "--kill-timeout":
        opts.killTimeout = parseInt(args[++i]!);
        break;
      case "--restart-delay":
        opts.restartDelay = parseInt(args[++i]!);
        break;
      case "--cron":
      case "--cron-restart":
        opts.cron = args[++i];
        break;
      case "--no-autorestart":
        opts.autorestart = false;
        break;
      case "--env": {
        const envPair = args[++i]!;
        const eqIdx = envPair.indexOf("=");
        if (eqIdx !== -1) {
          if (!opts.env) opts.env = {};
          opts.env[envPair.substring(0, eqIdx)] = envPair.substring(eqIdx + 1);
        }
        break;
      }
      case "--log":
      case "--output":
      case "-o":
        opts.outFile = args[++i];
        break;
      case "--error":
      case "-e":
        opts.errorFile = args[++i];
        break;
      case "--merge-logs":
        opts.mergeLogs = true;
        break;
      case "--log-date-format":
        opts.logDateFormat = args[++i];
        break;
      case "--log-max-size":
        opts.logMaxSize = args[++i];
        break;
      case "--log-retain":
        opts.logRetain = parseInt(args[++i]!);
        break;
      case "--log-compress":
        opts.logCompress = true;
        break;
      case "--port":
      case "-p":
        opts.port = parseInt(args[++i]!);
        break;
      case "--health-check-url":
        opts.healthCheckUrl = args[++i];
        break;
      case "--health-check-interval":
        opts.healthCheckInterval = parseInt(args[++i]!);
        break;
      case "--health-check-timeout":
        opts.healthCheckTimeout = parseInt(args[++i]!);
        break;
      case "--health-check-max-fails":
        opts.healthCheckMaxFails = parseInt(args[++i]!);
        break;
      case "--wait-ready":
        opts.waitReady = true;
        break;
      case "--listen-timeout":
        opts.listenTimeout = parseInt(args[++i]!);
        break;
      case "--namespace":
        opts.namespace = args[++i];
        break;
      case "--source-map-support":
        opts.sourceMapSupport = true;
        break;
      case "--":
        positionalArgs.push(...args.slice(i + 1));
        i = args.length;
        break;
      default:
        if (!arg.startsWith("-")) {
          positionalArgs.push(arg);
        }
        break;
    }
    i++;
  }

  if (positionalArgs.length > 0) {
    opts.args = positionalArgs;
  }

  return opts;
}
