const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { runSupervised } = require("./run-supervised.cjs");

const DEFAULT_API_PORT = 17632;
const HOST = "127.0.0.1";
const FRONTEND_PORT = 3000;
const repositoryRoot = path.resolve(__dirname, "..");

function readLocalEnvironment(workspace) {
  const environmentPath = path.join(
    repositoryRoot,
    "apps",
    workspace,
    ".env.local",
  );
  try {
    return parseEnv(fs.readFileSync(environmentPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function parseApiPort(rawPort) {
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      "The development API port must be an integer between 1 and 65535.",
    );
  }
  if (port === FRONTEND_PORT) {
    throw new Error("The API and frontend cannot share port 3000.");
  }
  return port;
}

function resolveApiPort(environment, apiEnvironment, webEnvironment) {
  // Local configuration wins over stale variables inherited by the terminal.
  const configuredUrl = webEnvironment.NEXT_PUBLIC_API_BASE_URL;
  if (configuredUrl) {
    const url = new URL(configuredUrl);
    if (
      url.protocol !== "http:" ||
      ![HOST, "localhost"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("NEXT_PUBLIC_API_BASE_URL must be a local HTTP origin.");
    }
    return parseApiPort(url.port || "80");
  }

  return parseApiPort(
    apiEnvironment.DASHBOARD_API_PORT ??
      environment.DASHBOARD_API_PORT ??
      DEFAULT_API_PORT,
  );
}

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      reject(
        new Error(
          `Cannot start development at http://${HOST}:${port}: ${error.code}. Close the existing listener and try again.`,
          { cause: error },
        ),
      );
    });
    server.listen(port, HOST, () => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

async function main() {
  const mode = process.argv[2] ?? "web";
  if (!["desktop", "web"].includes(mode)) {
    throw new Error(`Unsupported dev mode "${mode}". Use "web" or "desktop".`);
  }

  const uiArgument = process.argv
    .slice(3)
    .find((argument) => argument.startsWith("--ui="));
  const ui =
    uiArgument?.slice("--ui=".length) ??
    (process.stdout.isTTY ? "tui" : "stream");
  if (!["tui", "stream"].includes(ui)) {
    throw new Error(`Unsupported Turbo UI "${ui}". Use "tui" or "stream".`);
  }

  const childEnvironment = {
    ...process.env,
    HOSTNAME: HOST,
    PORT: String(FRONTEND_PORT),
  };
  const apiPort =
    mode === "web"
      ? resolveApiPort(
          process.env,
          readLocalEnvironment("api"),
          readLocalEnvironment("web"),
        )
      : null;

  await Promise.all([
    assertPortAvailable(FRONTEND_PORT),
    ...(apiPort === null ? [] : [assertPortAvailable(apiPort)]),
  ]);

  console.log(`[dev] Frontend: http://${HOST}:${FRONTEND_PORT}`);
  if (apiPort !== null) {
    const apiBaseUrl = `http://${HOST}:${apiPort}`;
    Object.assign(childEnvironment, {
      DASHBOARD_API_HOST: HOST,
      DASHBOARD_API_PORT: String(apiPort),
      NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
    });
    console.log(`[dev] Backend: ${apiBaseUrl}`);
  } else {
    console.log("[dev] Backend: embebido en Electron");
  }
  console.log(`[dev] Turbo UI: ${ui}`);

  runSupervised(
    process.execPath,
    [
      path.join(repositoryRoot, "node_modules", "turbo", "bin", "turbo"),
      "run",
      "dev",
      `--ui=${ui}`,
      "--filter=@dashboard/web",
      mode === "web"
        ? "--filter=@dashboard/api"
        : "--filter=@dashboard/desktop",
    ],
    { cwd: repositoryRoot, env: childEnvironment },
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[dev] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { assertPortAvailable, parseApiPort, resolveApiPort };
