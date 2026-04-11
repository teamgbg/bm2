/**
 * BM2 Signal Protection Wrapper
 * 
 * This wrapper intercepts signals to protected BM2 processes and validates
 * that SIGTERM/SIGINT only comes from the authorized BM2 daemon.
 * 
 * Usage: bm2-signal-protect <daemon_pid> <cmd> [args...]
 */

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <errno.h>
#include <time.h>

static pid_t child_pid = -1;
static pid_t authorized_daemon_pid = -1;
static volatile sig_atomic_t sigterm_received = 0;

void log_message(const char *level, const char *msg) {
    time_t now = time(NULL);
    char timebuf[64];
    struct tm *tm_info = localtime(&now);
    strftime(timebuf, sizeof(timebuf), "%Y-%m-%d %H:%M:%S", tm_info);
    fprintf(stderr, "[%s] [bm2-signal-protect] [%s] %s\n", timebuf, level, msg);
    fflush(stderr);
}

void log_warning(const char *msg) {
    log_message("WARN", msg);
}

void log_info(const char *msg) {
    log_message("INFO", msg);
}

void log_rejection(pid_t sender_pid) {
    char msg[512];
    snprintf(msg, sizeof(msg), 
        "REJECTED unauthorized kill attempt (pid=%d) against protected process (child=%d). "
        "This process is managed by BM2 (daemon_pid=%d). "
        "You must use 'bm2 stop <name>' or 'bm2 restart <name>' to manage it.",
        sender_pid, child_pid, authorized_daemon_pid);
    log_warning(msg);
}

void signal_handler(int signum, siginfo_t *info, void *context) {
    if (signum == SIGTERM || signum == SIGINT) {
        pid_t sender_pid = info->si_pid;
        
        if (child_pid <= 0) {
            /* Child hasn't been spawned yet or already exited */
            return;
        }
        
        /* Check if the signal is from the authorized daemon */
        if (sender_pid == authorized_daemon_pid || sender_pid == 1) {
            /* Authorized: forward to child */
            if (child_pid > 0) {
                char msg[256];
                snprintf(msg, sizeof(msg), 
                    "Received %s from authorized source (pid=%d), forwarding to child (pid=%d)",
                    signum == SIGTERM ? "SIGTERM" : "SIGINT", sender_pid, child_pid);
                log_info(msg);
                kill(child_pid, signum);
            }
        } else {
            /* Unauthorized: reject */
            log_rejection(sender_pid);
            /* Don't forward to child - process stays running */
        }
    }
}

int setup_signal_handlers(void) {
    struct sigaction sa;
    
    memset(&sa, 0, sizeof(sa));
    sa.sa_sigaction = signal_handler;
    sa.sa_flags = SA_SIGINFO;
    sigemptyset(&sa.sa_mask);
    
    if (sigaction(SIGTERM, &sa, NULL) < 0) {
        perror("sigaction SIGTERM");
        return -1;
    }
    
    if (sigaction(SIGINT, &sa, NULL) < 0) {
        perror("sigaction SIGINT");
        return -1;
    }
    
    return 0;
}

void forward_signals_to_child(int signum) {
    if (child_pid > 0) {
        kill(child_pid, signum);
    }
}

int main(int argc, char *argv[]) {
    if (argc < 3) {
        fprintf(stderr, "Usage: %s <daemon_pid> <cmd> [args...]\n", argv[0]);
        fprintf(stderr, "  daemon_pid - The PID of the BM2 daemon (authorized to send signals)\n");
        fprintf(stderr, "  cmd       - The command to run\n");
        fprintf(stderr, "  args...   - Arguments to the command\n");
        return 1;
    }
    
    authorized_daemon_pid = (pid_t)atoi(argv[1]);
    
    if (authorized_daemon_pid <= 0) {
        fprintf(stderr, "Invalid daemon PID: %s\n", argv[1]);
        return 1;
    }
    
    char msg[256];
    snprintf(msg, sizeof(msg), "Starting protected process wrapper (daemon_pid=%d, cmd=%s)", 
             authorized_daemon_pid, argv[2]);
    log_info(msg);
    
    /* Setup signal handlers before forking */
    if (setup_signal_handlers() < 0) {
        return 1;
    }
    
    /* Fork to create child process */
    child_pid = fork();
    
    if (child_pid < 0) {
        perror("fork");
        return 1;
    }
    
    if (child_pid == 0) {
        /* Child process - exec the actual command */
        execvp(argv[2], &argv[2]);
        perror("execvp");
        _exit(127);
    }
    
    /* Parent process - wait for child and forward signals */
    log_info("Child process started, now monitoring signals");
    
    int status;
    while (1) {
        int w = waitpid(child_pid, &status, WNOHANG);
        
        if (w == -1) {
            if (errno == EINTR) continue;
            break;
        }
        
        if (w == 0) {
            /* Child still running, pause until signal */
            pause();
            /* After pause returns (due to signal), re-check child status */
            continue;
        }
        
        /* Child has exited */
        if (WIFEXITED(status)) {
            snprintf(msg, sizeof(msg), "Child exited with status %d", WEXITSTATUS(status));
            log_info(msg);
            return WEXITSTATUS(status);
        } else if (WIFSIGNALED(status)) {
            snprintf(msg, sizeof(msg), "Child killed by signal %d", WTERMSIG(status));
            log_info(msg);
            return 128 + WTERMSIG(status);
        }
        break;
    }
    
    return 0;
}
