const { spawn, spawnSync } = require("node:child_process");

const SHUTDOWN_TIMEOUT_MS = 3_000;

/** Keep a command attached to its launcher and clean up its process tree. */
function runSupervised(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    // A process group lets POSIX stop descendants, including reload workers.
    detached: process.platform !== "win32",
    ...options,
  });
  let shutdownSignal;
  let shutdownTimeout;

  function stopTree(signal) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") {
        throw error;
      }
    }
  }

  function shutdown(signal) {
    if (shutdownSignal) {
      stopTree("SIGKILL");
      return;
    }
    shutdownSignal = signal;
    if (process.platform !== "win32") {
      stopTree(signal);
    } else if (signal !== "SIGINT") {
      stopTree("SIGKILL");
    }
    // Windows delivers console Ctrl+C to children too. Allow SQLite and reload
    // workers to close before terminating any remaining process tree.
    shutdownTimeout = setTimeout(
      () => stopTree("SIGKILL"),
      SHUTDOWN_TIMEOUT_MS,
    );
  }

  const handleInterrupt = () => shutdown("SIGINT");
  const handleTerminate = () => shutdown("SIGTERM");
  const handleHangup = () => shutdown("SIGHUP");
  const handleExit = () => stopTree("SIGKILL");
  process.on("SIGINT", handleInterrupt);
  process.on("SIGTERM", handleTerminate);
  process.on("SIGHUP", handleHangup);
  process.on("exit", handleExit);

  function cleanup() {
    clearTimeout(shutdownTimeout);
    process.off("SIGINT", handleInterrupt);
    process.off("SIGTERM", handleTerminate);
    process.off("SIGHUP", handleHangup);
    process.off("exit", handleExit);
  }

  child.once("error", (error) => {
    cleanup();
    console.error(`Unable to start ${command}: ${error.message}`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    cleanup();
    const finalSignal = shutdownSignal ?? signal;
    process.exitCode = finalSignal
      ? finalSignal === "SIGINT"
        ? 130
        : 143
      : (code ?? 1);
  });

  return child;
}

module.exports = { runSupervised };
