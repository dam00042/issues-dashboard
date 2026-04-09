const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const electronBinaryPath = require("electron");

const desktopDirectory = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(desktopDirectory, "..", "..");
const apiDirectory = path.join(repositoryRoot, "apps", "api");
const assetDirectory = path.join(desktopDirectory, "assets");
const webDirectory = path.join(repositoryRoot, "apps", "web");
const stageDirectory = path.join(desktopDirectory, ".packaged-app");
const releaseDirectory = path.join(desktopDirectory, "release");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const apiExecutablePath = path.join(
  apiDirectory,
  "dist-electron",
  "dashboard-api.exe",
);
const apiWorkDirectory = path.join(apiDirectory, "build-electron");
const webOutputPath = path.join(webDirectory, "out");
const portableReleaseDirectory = path.join(
  desktopDirectory,
  "release-portable",
);

function quoteWindowsArgument(argument) {
  if (!/[\s"]/u.test(argument)) {
    return argument;
  }

  return `"${argument.replace(/"/gu, '\\"')}"`;
}

function runCommand(command, args, cwd = repositoryRoot) {
  const result =
    process.platform === "win32"
      ? spawnSync(
          "cmd.exe",
          [
            "/d",
            "/s",
            "/c",
            [command, ...args].map(quoteWindowsArgument).join(" "),
          ],
          {
            cwd,
            stdio: "inherit",
          },
        )
      : spawnSync(command, args, {
          cwd,
          stdio: "inherit",
        });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function removePath(targetPath) {
  fs.rmSync(targetPath, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 250,
  });
}

function touchFileTimestamp(filePath) {
  const now = new Date();
  fs.utimesSync(filePath, now, now);
}

async function setWindowsExecutableIcon(executablePath) {
  if (process.platform !== "win32") {
    return;
  }

  const iconPath = path.join(desktopDirectory, "assets", "app-icon.ico");

  if (!fs.existsSync(iconPath)) {
    throw new Error(`Desktop icon file not found at ${iconPath}`);
  }

  let rcedit;
  try {
    ({ rcedit } = await import("rcedit"));
  } catch (error) {
    throw new Error(
      "rcedit is not installed. Run npm install --workspace @dashboard/desktop --save-dev rcedit",
      { cause: error },
    );
  }

  await rcedit(executablePath, {
    icon: iconPath,
  });
}

function stopReleaseProcesses() {
  if (process.platform !== "win32") {
    return;
  }

  const powershellScript =
    `$releaseRoots = @('${releaseDirectory}', '${portableReleaseDirectory}') | ForEach-Object { $_.ToLowerInvariant() }; ` +
    "Get-CimInstance Win32_Process | " +
    "Where-Object { $_.ExecutablePath } | " +
    "Where-Object { $processPath = $_.ExecutablePath.ToLowerInvariant(); $releaseRoots | Where-Object { $processPath.StartsWith($_) } } | " +
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }";

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", powershellScript],
    {
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }
}

function prepareDirectories() {
  stopReleaseProcesses();
  removePath(stageDirectory);
  removePath(releaseDirectory);
  removePath(portableReleaseDirectory);
  fs.mkdirSync(stageDirectory, { recursive: true });
  fs.mkdirSync(releaseDirectory, { recursive: true });
}

function ensureBuildArtifacts() {
  if (!fs.existsSync(path.join(webOutputPath, "index.html"))) {
    runCommand(npmCommand, ["run", "build"], webDirectory);
  }

  if (!fs.existsSync(apiExecutablePath)) {
    runCommand(npmCommand, ["run", "build:exe"], apiDirectory);
  }
}

function copyRequiredAssets() {
  const tweetNaclPath = path.join(repositoryRoot, "node_modules", "tweetnacl");

  fs.mkdirSync(path.join(stageDirectory, "backend"), { recursive: true });
  fs.mkdirSync(path.join(stageDirectory, "node_modules"), { recursive: true });

  fs.cpSync(
    path.join(desktopDirectory, "main.cjs"),
    path.join(stageDirectory, "main.cjs"),
  );
  fs.cpSync(
    path.join(desktopDirectory, "preload.cjs"),
    path.join(stageDirectory, "preload.cjs"),
  );
  fs.cpSync(
    path.join(desktopDirectory, "session-store.cjs"),
    path.join(stageDirectory, "session-store.cjs"),
  );
  fs.cpSync(assetDirectory, path.join(stageDirectory, "assets"), {
    recursive: true,
  });
  fs.cpSync(
    tweetNaclPath,
    path.join(stageDirectory, "node_modules", "tweetnacl"),
    { recursive: true },
  );
  fs.cpSync(webOutputPath, path.join(stageDirectory, "web"), {
    recursive: true,
  });
  fs.cpSync(
    apiExecutablePath,
    path.join(stageDirectory, "backend", "dashboard-api.exe"),
  );
}

function writeStagePackageManifest() {
  const packageManifest = {
    author: "GitHub Issues Dashboard",
    dependencies: {
      tweetnacl: "1.0.3",
    },
    description: "Desktop shell for GitHub Issues Dashboard",
    main: "main.cjs",
    name: "github-issues-dashboard-desktop",
    productName: "GitHub Issues Dashboard",
    version: "0.1.0",
  };

  fs.writeFileSync(
    path.join(stageDirectory, "package.json"),
    JSON.stringify(packageManifest, null, 2),
  );
}

async function buildDesktopRelease() {
  const electronRuntimeDirectory = path.dirname(electronBinaryPath);
  const packagedDirectory = path.join(
    releaseDirectory,
    "GitHub Issues Dashboard-win32-x64",
  );
  const appResourceDirectory = path.join(packagedDirectory, "resources", "app");
  const defaultAppPath = path.join(
    packagedDirectory,
    "resources",
    "default_app.asar",
  );
  const defaultExecutablePath = path.join(packagedDirectory, "electron.exe");
  const targetExecutablePath = path.join(
    packagedDirectory,
    "GitHub Issues Dashboard.exe",
  );

  fs.cpSync(electronRuntimeDirectory, packagedDirectory, { recursive: true });

  if (fs.existsSync(defaultAppPath)) {
    removePath(defaultAppPath);
  }

  removePath(appResourceDirectory);
  fs.mkdirSync(appResourceDirectory, { recursive: true });
  fs.cpSync(stageDirectory, appResourceDirectory, { recursive: true });

  if (fs.existsSync(targetExecutablePath)) {
    removePath(targetExecutablePath);
  }

  fs.renameSync(defaultExecutablePath, targetExecutablePath);
  await setWindowsExecutableIcon(targetExecutablePath);
  touchFileTimestamp(targetExecutablePath);
}

function cleanupIntermediateArtifacts() {
  removePath(stageDirectory);
  removePath(apiExecutablePath);
  removePath(apiWorkDirectory);
  removePath(webOutputPath);
}

async function main() {
  prepareDirectories();
  ensureBuildArtifacts();
  copyRequiredAssets();
  writeStagePackageManifest();
  await buildDesktopRelease();
  cleanupIntermediateArtifacts();

  console.log(
    `Desktop package created at ${path.join(releaseDirectory, "GitHub Issues Dashboard-win32-x64")}`,
  );
}

main().catch((error) => {
  console.error("Desktop build pipeline failed.", error);
  process.exitCode = 1;
});
