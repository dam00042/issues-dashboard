const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const net = require("node:net");
const http = require("node:http");
const path = require("node:path");
const { test } = require("node:test");
const { parseEnv } = require("node:util");
const {
  assertPortAvailable,
  parseApiPort,
  resolveApiPort,
} = require("./run-turbo-dev.cjs");
const {
  getPythonLaunch,
  getUvLaunch,
} = require("../apps/api/scripts/python-runtime.cjs");

const supervisorPath = path.join(__dirname, "run-supervised.cjs");
const {
  parseOptions,
  waitForUrl,
} = require("../apps/desktop/scripts/run-electron.cjs");

test("desktop launch arguments preserve the app path and readiness settings", () => {
  assert.deepEqual(parseOptions([".", "--wait-url=http://127.0.0.1:3000"]), {
    appPath: process.cwd(),
    waitUrl: "http://127.0.0.1:3000",
    waitTimeoutMs: 120_000,
    waitIntervalMs: 350,
  });
  const configured = parseOptions([
    "--wait-timeout-ms=1000",
    "--wait-interval-ms=invalid",
  ]);
  assert.equal(configured.waitTimeoutMs, 1000);
  assert.equal(configured.waitIntervalMs, 350);
});

test("desktop readiness retries server errors and reports startup timeouts", async () => {
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests += 1;
    response.writeHead(requests === 1 ? 503 : 200);
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await waitForUrl(url, 5_000, 1);
    assert.equal(requests, 2);
    await assert.rejects(waitForUrl(url, 0, 1), {
      message: `Timed out waiting for ${url}`,
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("local API configuration overrides inherited terminal variables", () => {
  const inherited = { DASHBOARD_API_PORT: "8010" };
  const webLocal = parseEnv(
    '  NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:17632" # local API',
  );
  assert.equal(
    resolveApiPort(inherited, { DASHBOARD_API_PORT: "12345" }, webLocal),
    17632,
  );
  assert.equal(
    resolveApiPort(inherited, { DASHBOARD_API_PORT: "17632" }, {}),
    17632,
  );
  assert.equal(resolveApiPort(inherited, {}, {}), 8010);
  assert.equal(resolveApiPort({}, {}, {}), 17632);
});

test("invalid API ports and remote origins fail instead of selecting random ports", () => {
  for (const port of ["", "0", "-1", "1.5", "17632junk", "65536", "3000"]) {
    assert.throws(() => parseApiPort(port));
  }
  for (const url of [
    "not a URL",
    "https://127.0.0.1:17632",
    "http://example.com:17632",
    "http://127.0.0.1:17632/api",
    "http://user:password@127.0.0.1:17632",
  ]) {
    assert.throws(() =>
      resolveApiPort({}, {}, { NEXT_PUBLIC_API_BASE_URL: url }),
    );
  }
});

test("port conflicts preserve the existing listener and report its exact origin", async () => {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  try {
    await assert.rejects(assertPortAvailable(port), {
      message: new RegExp(`127\\.0\\.0\\.1:${port}: EADDRINUSE`),
    });
    assert.equal(listener.listening, true);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
  await assertPortAvailable(port);
});

test("Python commands use uv, the frozen lock, and only the API project environment", () => {
  const launch = getPythonLaunch(["-m", "pytest"]);
  assert.deepEqual(launch.args.slice(0, 4), ["-m", "uv", "run", "--project"]);
  assert.deepEqual(launch.args.slice(5), [
    "--frozen",
    "python",
    "-m",
    "pytest",
  ]);
  assert.equal(launch.options.cwd, path.resolve(__dirname, "../apps/api"));
  const configured = getUvLaunch(["sync"], {
    env: { UV_PROJECT_ENVIRONMENT: "wrong-venv" },
  });
  assert.equal(
    configured.options.env.UV_PROJECT_ENVIRONMENT,
    path.join(launch.options.cwd, ".venv"),
  );
});

test("the supervisor preserves command failures and handles launch errors", () => {
  for (const [command, args, expected] of [
    [process.execPath, ["-e", "process.exit(7)"], 7],
    ["issues-dashboard-nonexistent-test-command", [], 1],
  ]) {
    const script = `require(${JSON.stringify(supervisorPath)}).runSupervised(${JSON.stringify(command)}, ${JSON.stringify(args)})`;
    const result = spawnSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, expected, result.stderr);
  }
});

test("shutdown closes the supervised command and its listening grandchild", {
  timeout: 20_000,
}, async () => {
  const grandchildScript = `const net = require("node:net");
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      console.log(JSON.stringify({ pid: process.pid, port: server.address().port }));
    });`;
  const childScript = `require("node:child_process").spawn(process.execPath,
    ["-e", ${JSON.stringify(grandchildScript)}], { stdio: "inherit", windowsHide: true });
    setInterval(() => {}, 1000);`;
  const launcherScript = `require(${JSON.stringify(supervisorPath)}).runSupervised(
    process.execPath, ["-e", ${JSON.stringify(childScript)}]);
    process.stdin.once("data", () => {
      process.stdin.destroy();
      process.emit("SIGTERM");
    });`;
  const launcher = spawn(process.execPath, ["-e", launcherScript], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const closed = once(launcher, "close");
  let diagnostics = "";
  launcher.stderr.on("data", (chunk) => {
    diagnostics += chunk;
  });
  try {
    const [output] = await once(launcher.stdout, "data");
    const { pid, port } = JSON.parse(output.toString().trim());
    launcher.stdin.end("stop");
    const [code] = await closed;
    assert.equal(code, 143, diagnostics);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    await assertPortAvailable(port);
  } finally {
    if (launcher.exitCode === null && launcher.signalCode === null) {
      if (process.platform === "win32") {
        spawnSync("taskkill.exe", ["/pid", String(launcher.pid), "/t", "/f"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        launcher.kill("SIGTERM");
      }
    }
  }
});
