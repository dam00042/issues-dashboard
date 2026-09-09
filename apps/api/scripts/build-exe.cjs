const fs = require("node:fs");
const path = require("node:path");
const { runPython } = require("./python-runtime.cjs");

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
  runPython([
    "-m",
    "PyInstaller",
    "--clean",
    "--noconfirm",
    "--onedir",
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
  ]);
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
