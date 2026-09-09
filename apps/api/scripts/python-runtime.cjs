const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runSupervised } = require("../../../scripts/run-supervised.cjs");

const apiDirectory = path.resolve(__dirname, "..");

function getUvLaunch(args, options = {}) {
  return {
    command:
      process.env.DASHBOARD_BOOTSTRAP_PYTHON?.trim() ||
      (process.platform === "win32" ? "python.exe" : "python3"),
    args: ["-m", "uv", ...args],
    options: {
      cwd: apiDirectory,
      stdio: "inherit",
      windowsHide: true,
      ...options,
      env: {
        ...process.env,
        ...options.env,
        // There is one project environment, even when another venv is active.
        UV_PROJECT_ENVIRONMENT: path.join(apiDirectory, ".venv"),
      },
    },
  };
}

function getPythonLaunch(args, options = {}) {
  return getUvLaunch(
    ["run", "--project", apiDirectory, "--frozen", "python", ...args],
    options,
  );
}

function runPython(args, options = {}) {
  const launch = getPythonLaunch(args, options);
  const result = spawnSync(launch.command, launch.args, launch.options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Python command failed with exit code ${String(result.status)}.`,
    );
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const launch =
    args[0] === "--uv" ? getUvLaunch(args.slice(1)) : getPythonLaunch(args);
  runSupervised(launch.command, launch.args, launch.options);
}

module.exports = { getPythonLaunch, getUvLaunch, runPython };
