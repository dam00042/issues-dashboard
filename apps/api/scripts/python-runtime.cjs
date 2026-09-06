const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const apiDirectory = path.resolve(__dirname, "..");
const sourceDirectory = path.join(apiDirectory, "src");

function resolveBootstrapPythonExecutable() {
  const configuredExecutable = process.env.DASHBOARD_BOOTSTRAP_PYTHON?.trim();
  if (configuredExecutable) {
    return configuredExecutable;
  }

  return process.platform === "win32" ? "python.exe" : "python3";
}

function resolvePythonExecutable() {
  const configuredExecutable = process.env.DASHBOARD_PYTHON?.trim();
  if (configuredExecutable) {
    return configuredExecutable;
  }

  const virtualEnvironmentExecutable =
    process.platform === "win32"
      ? path.join(apiDirectory, ".venv", "Scripts", "python.exe")
      : path.join(apiDirectory, ".venv", "bin", "python");
  if (fs.existsSync(virtualEnvironmentExecutable)) {
    return virtualEnvironmentExecutable;
  }

  return process.platform === "win32" ? "python.exe" : "python3";
}

function runExecutable(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: apiDirectory,
    stdio: "inherit",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Python command failed with exit code ${String(result.status)}.`);
  }
}

function runBootstrapPython(args, options = {}) {
  runExecutable(resolveBootstrapPythonExecutable(), args, options);
}

function runPython(args, options = {}) {
  const inheritedEnvironment = {
    ...process.env,
    ...(options.env ?? {}),
  };
  const existingPythonPath = inheritedEnvironment.PYTHONPATH?.trim();
  inheritedEnvironment.PYTHONPATH = existingPythonPath
    ? `${sourceDirectory}${path.delimiter}${existingPythonPath}`
    : sourceDirectory;
  runExecutable(resolvePythonExecutable(), args, {
    ...options,
    env: inheritedEnvironment,
  });
}

module.exports = {
  resolveBootstrapPythonExecutable,
  resolvePythonExecutable,
  runBootstrapPython,
  runPython,
};
