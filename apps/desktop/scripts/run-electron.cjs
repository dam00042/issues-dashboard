const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { URL } = require("node:url");

const electronBinary = require("electron");

const DEFAULT_WAIT_INTERVAL_MS = 350;
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;

function parseIntegerFlag(rawValue, fallbackValue) {
  if (rawValue === undefined) {
    return fallbackValue;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isNaN(parsedValue) ? fallbackValue : parsedValue;
}

function parseOptions(argv) {
  const positionalArguments = [];
  let waitIntervalMs = DEFAULT_WAIT_INTERVAL_MS;
  let waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS;
  let waitUrl = null;

  for (const argument of argv.slice(2)) {
    if (argument.startsWith("--wait-url=")) {
      waitUrl = argument.slice("--wait-url=".length);
      continue;
    }

    if (argument.startsWith("--wait-timeout-ms=")) {
      waitTimeoutMs = parseIntegerFlag(
        argument.slice("--wait-timeout-ms=".length),
        DEFAULT_WAIT_TIMEOUT_MS,
      );
      continue;
    }

    if (argument.startsWith("--wait-interval-ms=")) {
      waitIntervalMs = parseIntegerFlag(
        argument.slice("--wait-interval-ms=".length),
        DEFAULT_WAIT_INTERVAL_MS,
      );
      continue;
    }

    positionalArguments.push(argument);
  }

  return {
    appPath: path.resolve(process.cwd(), positionalArguments[0] ?? "."),
    waitIntervalMs,
    waitTimeoutMs,
    waitUrl,
  };
}

function probeHttpUrl(rawUrl) {
  return new Promise((resolve) => {
    let urlObject;

    try {
      urlObject = new URL(rawUrl);
    } catch {
      resolve(false);
      return;
    }

    const client = urlObject.protocol === "https:" ? https : http;
    const request = client.request(urlObject, { method: "GET" }, (response) => {
      response.resume();
      resolve((response.statusCode ?? 500) < 500);
    });

    request.on("error", () => {
      resolve(false);
    });

    request.setTimeout(3_000, () => {
      request.destroy();
      resolve(false);
    });

    request.end();
  });
}

async function waitForUrl(url, timeoutMs, intervalMs) {
  const timeoutAt = Date.now() + timeoutMs;

  while (Date.now() < timeoutAt) {
    const isReady = await probeHttpUrl(url);

    if (isReady) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const options = parseOptions(process.argv);

  if (options.waitUrl) {
    console.log(`[desktop:dev] Waiting for ${options.waitUrl} ...`);
    await waitForUrl(
      options.waitUrl,
      options.waitTimeoutMs,
      options.waitIntervalMs,
    );
  }

  const childEnvironment = { ...process.env };

  delete childEnvironment.ELECTRON_RUN_AS_NODE;

  const childProcess = spawn(electronBinary, [options.appPath], {
    cwd: process.cwd(),
    env: childEnvironment,
    stdio: "inherit",
  });

  childProcess.on("error", (error) => {
    console.error("Unable to launch Electron.", error);
    process.exitCode = 1;
  });

  childProcess.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exitCode = code ?? 0;
  });
}

void main().catch((error) => {
  console.error("Unable to launch Electron.", error);
  process.exitCode = 1;
});
