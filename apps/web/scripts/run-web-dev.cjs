const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const EXPECTED_TITLE = "GitHub Issues Dashboard v3";
const HEALTH_CHECK_TIMEOUT_MS = 1_500;

const workspaceDirectory = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(workspaceDirectory, "..", "..");
const staleLockPath = path.join(workspaceDirectory, ".next", "dev", "lock");
const nextBinaryPath = require.resolve("next/dist/bin/next");
const workspaceNextServerPath = path.join(
  repositoryRoot,
  "node_modules",
  "next",
  "dist",
  "server",
  "lib",
  "start-server.js",
);

function normalizePathForComparison(value) {
  return value.replaceAll("/", "\\").toLowerCase();
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isPortAvailable(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function isWorkspaceDevServerRunning(port, host) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, HEALTH_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(`http://${host}:${String(port)}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    const html = await response.text();

    return response.ok && html.includes(EXPECTED_TITLE);
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

function removeStaleLockIfPresent() {
  if (!fs.existsSync(staleLockPath)) {
    return;
  }

  try {
    fs.rmSync(staleLockPath, { force: true });
    console.log("[web:dev] Removed stale Next.js dev lock.");
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "Unable to remove the stale Next.js dev lock.",
    );
  }
}

function getListeningPortOwner(port) {
  if (process.platform !== "win32") {
    return null;
  }

  try {
    const rawOutput = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$connection = Get-NetTCPConnection -LocalPort ${String(port)} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if (-not $connection) { exit 0 }; $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)"; if ($null -eq $process) { exit 0 }; @{ pid = $process.ProcessId; commandLine = $process.CommandLine } | ConvertTo-Json -Compress`,
      ],
      {
        cwd: workspaceDirectory,
        encoding: "utf8",
      },
    ).trim();

    if (!rawOutput) {
      return null;
    }

    const parsedOutput = JSON.parse(rawOutput);
    return {
      commandLine: String(parsedOutput.commandLine ?? ""),
      pid: Number(parsedOutput.pid),
    };
  } catch {
    return null;
  }
}

function isWorkspaceNextServer(portOwner) {
  if (!portOwner?.commandLine) {
    return false;
  }

  const normalizedCommandLine = normalizePathForComparison(
    portOwner.commandLine,
  );
  return normalizedCommandLine.includes(
    normalizePathForComparison(workspaceNextServerPath),
  );
}

function stopWorkspacePortOwner(portOwner) {
  if (!portOwner?.pid) {
    return;
  }

  execFileSync("taskkill.exe", ["/pid", String(portOwner.pid), "/t", "/f"], {
    cwd: workspaceDirectory,
    stdio: "ignore",
  });
}

async function keepAliveForReusedServer(port, host) {
  console.log(
    `[web:dev] Reusing the existing frontend at http://${host}:${String(port)}.`,
  );

  for (;;) {
    await delay(5_000);
    const isStillRunning = await isWorkspaceDevServerRunning(port, host);

    if (!isStillRunning) {
      console.error("[web:dev] The reused frontend server stopped responding.");
      process.exit(1);
    }
  }
}

async function main() {
  const host = process.env.HOSTNAME || DEFAULT_HOST;
  const port = Number.parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  let portAvailable = await isPortAvailable(port, host);

  if (!portAvailable) {
    const portOwner = getListeningPortOwner(port);

    if (isWorkspaceNextServer(portOwner)) {
      console.log(
        "[web:dev] Stopping the stale workspace frontend on port 3000.",
      );
      stopWorkspacePortOwner(portOwner);
      await delay(500);
      portAvailable = await isPortAvailable(port, host);
    }
  }

  if (!portAvailable) {
    const isWorkspaceServer = await isWorkspaceDevServerRunning(port, host);

    if (isWorkspaceServer) {
      await keepAliveForReusedServer(port, host);
      return;
    }

    console.error(
      `[web:dev] Port ${String(port)} is busy. Free http://${host}:${String(port)} and try again.`,
    );
    process.exit(1);
    return;
  }

  removeStaleLockIfPresent();

  const childProcess = spawn(
    process.execPath,
    [
      nextBinaryPath,
      "dev",
      "--webpack",
      "--hostname",
      host,
      "--port",
      String(port),
    ],
    {
      cwd: workspaceDirectory,
      env: process.env,
      stdio: "inherit",
    },
  );

  childProcess.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

void main();
