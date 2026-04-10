import { VERSION } from "./constants";
import { colorize } from "./utils";

export function printHelp() {
    console.log(`
    ${colorize("BM2", "bold")} ${colorize(`v${VERSION}`, "dim")} — Bun Process Manager
    
    ${colorize("Usage:", "bold")} bm2 <command> [options]
    
    ${colorize("Process Management:", "cyan")}
    start <script|config> [opts]  Start a process or ecosystem config
    stop [id|name|all]            Stop process(es)
    restart [id|name|all]         Restart process(es)
    reload [id|name|all]          Graceful zero-downtime reload
    delete [id|name|all]          Stop and remove process(es)
    scale <id|name> <count>       Scale to N instances
    list | ls | status            List all processes
    describe <id|name>            Show detailed process info
    reset <id|name|all>           Reset restart counters
    
    ${colorize("Logs:", "cyan")}
    logs [id|name|all] [--lines N]  Show recent logs
    flush [id|name]                 Clear log files
    
    ${colorize("Monitoring:", "cyan")}
    monit                         Show live metrics snapshot
    dashboard [--port N]          Start web dashboard
    dashboard stop                Stop web dashboard
    prometheus                    Print Prometheus metrics
    
    ${colorize("Persistence:", "cyan")}
    save                          Save current process list
    resurrect                     Restore saved process list
    startup [install|remove]      Generate/install startup script
    
    ${colorize("Deploy:", "cyan")}
    deploy <config> <env> [setup] Deploy using ecosystem config
    
    ${colorize("Environment:", "cyan")}
    env set <name> <key> <val>    Set env variable
    env get <name>                List env vars for a process
    env delete <name> [key]       Delete env variable(s)
    env list                      List all env registries
    
    ${colorize("Modules:", "cyan")}
    module install <name|url>     Install a BM2 module
    module uninstall <name>       Remove a module
    module list                   List installed modules
    
    ${colorize("Daemon:", "cyan")}
    daemon status                 Returns the status of the daemon
    daemon start                  Starts the daemon
    daemon start                  Stops the daemon
    daemon reload                 Reloads the daemon
    
    ${colorize("Daemon:", "cyan")}
    ping                          Check if daemon is alive
    kill                          Kill the daemon and all processes
    sendSignal <sig> <id|name>    Send OS signal to process
    
    ${colorize("Start Options:", "dim")}
    --name, -n <name>             Process name
    --instances, -i <N>           Number of instances (cluster)
    --exec-mode, -x <mode>       fork or cluster
    --watch, -w                   Watch for file changes
    --cwd <path>                  Working directory
    --interpreter <bin>           Custom interpreter
    --node-args <args>            Extra runtime arguments
    --max-memory-restart <size>   e.g. 200M, 1G
    --max-restarts <N>            Max restart attempts
    --cron, --cron-restart <expr> Cron-based restart schedule
    --port, -p <port>             Base port for cluster
    --env <KEY=VALUE>             Set environment variable
    --no-autorestart              Disable auto-restart
    --log, -o <file>              Custom stdout log path
    --error, -e <file>            Custom stderr log path
    --namespace <ns>              Namespace grouping
    --wait-ready                  Wait for ready signal
    --health-check-url <url>      HTTP health check endpoint
    -- <args...>                  Pass arguments to script
    
    ${colorize("Examples:", "dim")}
    bm2 start app.ts
    bm2 start server.ts --name api -i 4 --watch
    bm2 start ecosystem.config.ts
    bm2 restart api
    bm2 scale api 8
    bm2 logs api --lines 100
    bm2 monit
    bm2 save && bm2 resurrect
    `);
    }
