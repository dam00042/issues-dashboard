const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { parseArgs } = require("node:util");
const { runSupervised } = require("../../../scripts/run-supervised.cjs");

function parseOptions(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "wait-url": { type: "string" },
      "wait-timeout-ms": { type: "string", default: "120000" },
      "wait-interval-ms": { type: "string", default: "350" },
    },
  });
  const parseInteger = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  };
  return {
    appPath: path.resolve(positionals[0] ?? "."),
    waitUrl: values["wait-url"],
    waitTimeoutMs: parseInteger(values["wait-timeout-ms"], 120_000),
    waitIntervalMs: parseInteger(values["wait-interval-ms"], 350),
  };
}

async function waitForUrl(url, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(3_000),
      });
      await response.body?.cancel();
      if (response.status < 500) {
        return;
      }
    } catch {
      // Next may still be starting; retry until the launch deadline.
    }
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.waitUrl) {
    console.log(`[desktop:dev] Waiting for ${options.waitUrl} ...`);
    await waitForUrl(
      options.waitUrl,
      options.waitTimeoutMs,
      options.waitIntervalMs,
    );
  }
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  runSupervised(require("electron"), [options.appPath], { env: environment });
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Unable to launch Electron.", error);
    process.exitCode = 1;
  });
}

module.exports = { parseOptions, waitForUrl };
