const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const apiDirectory = path.resolve(__dirname, "..");
const distDirectory = path.join(apiDirectory, "dist-electron");
const buildRootDirectory = path.join(apiDirectory, "build-electron");
const workDirectory = path.join(buildRootDirectory, `run-${Date.now()}`);
const specFilePath = path.join(apiDirectory, "dashboard-api.spec");

function removePath(targetPath) {
  fs.rmSync(targetPath, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 250,
  });
}

function runPyInstaller() {
  const result = spawnSync(
    "python",
    [
      "-m",
      "uv",
      "run",
      "--project",
      ".",
      "pyinstaller",
      "--clean",
      "--noconfirm",
      "--onefile",
      "--name",
      "dashboard-api",
      "--hidden-import",
      "_cffi_backend",
      "--collect-submodules",
      "nacl",
      "--collect-binaries",
      "nacl",
      "--collect-data",
      "nacl",
      "--collect-data",
      "cffi",
      "--distpath",
      "dist-electron",
      "--workpath",
      workDirectory,
      "src/dashboard_api/__main__.py",
    ],
    {
      cwd: apiDirectory,
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error("PyInstaller build failed.");
  }
}

function main() {
  removePath(distDirectory);
  removePath(workDirectory);
  fs.mkdirSync(buildRootDirectory, { recursive: true });

  try {
    runPyInstaller();
  } finally {
    removePath(workDirectory);
    removePath(specFilePath);
  }
}

main();

