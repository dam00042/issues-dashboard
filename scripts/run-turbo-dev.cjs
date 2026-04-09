const net = require("node:net");
const { spawn } = require("node:child_process");
const path = require("node:path");

const DEFAULT_API_PORT = 8010;
const DEFAULT_FRONTEND_URL = "http://127.0.0.1:3000";
const mode = process.argv[2] ?? "web";
const supportedModes = new Set(["desktop", "web"]);

function parseUiOverride() {
  for (const argument of process.argv.slice(3)) {
    if (argument.startsWith("--ui=")) {
      return argument.slice("--ui=".length);
    }
  }

  return process.stdout.isTTY ? "tui" : "stream";
}

function getTurboLaunch() {
  return {
    args: [path.join(__dirname, "..", "node_modules", "turbo", "bin", "turbo")],
    command: process.execPath,
  };
}

function reservePort(preferredPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(preferredPort, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve the local API port."));
        return;
      }

      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function resolveApiPort() {
  const rawPort = process.env.DASHBOARD_API_PORT;
  const parsedPort = Number.parseInt(rawPort ?? String(DEFAULT_API_PORT), 10);
  const preferredPort = Number.isNaN(parsedPort) ? DEFAULT_API_PORT : parsedPort;

  try {
    return await reservePort(preferredPort);
  } catch {
    return reservePort(0);
  }
}

async function main() {
  if (!supportedModes.has(mode)) {
    console.error(
      `Unsupported dev mode "${mode}". Use "web" or "desktop" instead.`,
    );
    process.exitCode = 1;
    return;
  }

  const ui = parseUiOverride();
  const filters =
    mode === "desktop"
      ? [
          "--filter=@dashboard/web",
          "--filter=@dashboard/desktop",
        ]
      : [
          "--filter=@dashboard/api",
          "--filter=@dashboard/web",
        ];
  const apiPort = mode === "web" ? await resolveApiPort() : null;
  const childEnvironment = { ...process.env };

  if (apiPort !== null) {
    const apiBaseUrl = `http://127.0.0.1:${String(apiPort)}`;

    childEnvironment.DASHBOARD_API_PORT = String(apiPort);
    childEnvironment.HOSTNAME = "127.0.0.1";
    childEnvironment.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
    childEnvironment.PORT = "3000";

    console.log(`[dev] Frontend: ${DEFAULT_FRONTEND_URL}`);
    console.log(`[dev] Backend: ${apiBaseUrl}`);
  } else {
    childEnvironment.HOSTNAME = "127.0.0.1";
    childEnvironment.PORT = "3000";
    console.log(`[dev] Frontend: ${DEFAULT_FRONTEND_URL}`);
    console.log("[dev] Backend: embebido en Electron");
  }

  if (ui === "tui") {
    console.log(
      "[dev] Turbo TUI activo. Usa las flechas del teclado para cambiar de tarea.",
    );
  } else {
    console.log(`[dev] Turbo UI: ${ui}`);
  }

  const turboLaunch = getTurboLaunch();
  const childProcess = spawn(
    turboLaunch.command,
    [...turboLaunch.args, "run", "dev", `--ui=${ui}`, ...filters],
    {
      env: childEnvironment,
      shell: false,
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

