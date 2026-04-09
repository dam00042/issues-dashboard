const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const electronModule = require("electron");
const {
  Menu,
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  safeStorage,
  shell,
} = typeof electronModule === "string" ? {} : electronModule;

const {
  clearSessionRecord,
  createEncryptedSessionRecord,
  decryptSessionToken,
  readSessionRecord,
  writeSessionRecord,
} = require("./session-store.cjs");

const APP_TITLE = "Issues Dashboard";
const APP_USER_MODEL_ID = "com.githubissuesdashboard";
const BACKEND_HEALTH_TIMEOUT_MS = 20_000;
const DEFAULT_API_PORT = 8010;
const DEFAULT_BACKGROUND_DARK = "#111827";
const DEFAULT_BACKGROUND_LIGHT = "#f5efe7";
const DEV_FRONTEND_URL = "http://127.0.0.1:3000";

let backendPort = null;
let backendProcess = null;
let backendReady = false;
let backendStartupPromise = null;
let mainWindow = null;

function buildApplicationMenu() {
  return Menu.buildFromTemplate([
    {
      label: "Editar",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
  ]);
}

function getDesktopIconPath() {
  return path.join(__dirname, "assets", "app-icon.ico");
}

function getDesktopLogFilePath() {
  if (app && typeof app.getPath === "function") {
    try {
      return path.join(app.getPath("userData"), "desktop.log");
    } catch {
      // Fall back to a deterministic path outside Electron userData.
    }
  }

  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, APP_TITLE, "desktop.log");
  }

  return path.join(process.cwd(), "desktop.log");
}

function writeDesktopLog(message, error) {
  const errorText =
    error instanceof Error ? `\n${error.stack ?? error.message}` : "";
  const logLine = `[${new Date().toISOString()}] ${message}${errorText}\n`;

  try {
    fs.mkdirSync(path.dirname(getDesktopLogFilePath()), { recursive: true });
    fs.appendFileSync(getDesktopLogFilePath(), logLine);
  } catch (writeError) {
    console.error("[desktop:log] Unable to write desktop log.", writeError);
  }

  console.log(logLine.trimEnd());
}

function getSessionFilePath() {
  return path.join(app.getPath("userData"), "session.json");
}

function getDatabaseFilePath() {
  return path.join(app.getPath("userData"), "issues.db");
}

function getBackendSessionFilePath() {
  return path.join(app.getPath("userData"), "backend-session.json");
}

function getBackendSessionKeyFilePath() {
  return path.join(app.getPath("userData"), "backend-session.key");
}

function buildDatabaseExportFileName() {
  const timestamp = new Date()
    .toISOString()
    .replace(/:/gu, "-")
    .replace(/\..+$/u, "");
  return `issues-dashboard-${timestamp}.db`;
}

async function exportDatabaseFile() {
  const databaseFilePath = getDatabaseFilePath();
  if (!fs.existsSync(databaseFilePath)) {
    throw new Error("Todavia no existe una base de datos local para exportar.");
  }

  const saveResult = await dialog.showSaveDialog({
    buttonLabel: "Exportar",
    defaultPath: path.join(
      app.getPath("documents"),
      buildDatabaseExportFileName(),
    ),
    filters: [
      {
        extensions: ["db", "sqlite", "sqlite3"],
        name: "SQLite",
      },
    ],
    properties: ["createDirectory", "showOverwriteConfirmation"],
    title: "Exportar base de datos",
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { cancelled: true, path: null };
  }

  fs.copyFileSync(databaseFilePath, saveResult.filePath);
  return { cancelled: false, path: saveResult.filePath };
}

async function importDatabaseFile() {
  const openResult = await dialog.showOpenDialog({
    buttonLabel: "Importar",
    filters: [
      {
        extensions: ["db", "sqlite", "sqlite3"],
        name: "SQLite",
      },
    ],
    properties: ["openFile"],
    title: "Importar base de datos",
  });

  if (openResult.canceled || openResult.filePaths.length === 0) {
    return { cancelled: true, path: null };
  }

  const [selectedFilePath] = openResult.filePaths;
  if (!selectedFilePath || !fs.existsSync(selectedFilePath)) {
    throw new Error("No se pudo localizar el archivo seleccionado.");
  }

  const hadStoredSession = hasStoredSession();
  await stopBackendProcess();

  const destinationPath = getDatabaseFilePath();
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(selectedFilePath, destinationPath);

  if (hadStoredSession) {
    await startBackendProcess({ forceRestart: true });
  }

  return { cancelled: false, path: selectedFilePath };
}

function getApiBaseUrl() {
  return `http://127.0.0.1:${backendPort ?? DEFAULT_API_PORT}`;
}

function wrapMasterKey(masterKeyBase64) {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      protection: "safe-storage",
      value: safeStorage.encryptString(masterKeyBase64).toString("base64"),
    };
  }

  return {
    protection: "plaintext-fallback",
    value: masterKeyBase64,
  };
}

function unwrapMasterKey(wrappedKey) {
  if (wrappedKey.protection === "safe-storage") {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Electron safeStorage is not available on this machine.");
    }

    return safeStorage.decryptString(Buffer.from(wrappedKey.value, "base64"));
  }

  return wrappedKey.value;
}

function getStoredSessionRecord() {
  try {
    return readSessionRecord(getSessionFilePath());
  } catch (error) {
    writeDesktopLog("[desktop:session] Unable to read session record.", error);
    return null;
  }
}

function getStoredGitHubToken() {
  const sessionRecord = getStoredSessionRecord();

  if (!sessionRecord) {
    return "";
  }

  try {
    return decryptSessionToken(sessionRecord, unwrapMasterKey);
  } catch (error) {
    writeDesktopLog(
      "[desktop:session] Unable to decrypt session token.",
      error,
    );
    return "";
  }
}

function hasStoredSession() {
  return Boolean(getStoredSessionRecord());
}

function resolveDesktopBackgroundColor(theme) {
  if (theme === "dark") {
    return DEFAULT_BACKGROUND_DARK;
  }

  if (theme === "light") {
    return DEFAULT_BACKGROUND_LIGHT;
  }

  return nativeTheme.shouldUseDarkColors
    ? DEFAULT_BACKGROUND_DARK
    : DEFAULT_BACKGROUND_LIGHT;
}

function getDevelopmentBackendCommand() {
  const apiDirectory = path.resolve(__dirname, "..", "api");
  const pythonExecutable =
    process.platform === "win32"
      ? path.join(apiDirectory, ".venv", "Scripts", "python.exe")
      : path.join(apiDirectory, ".venv", "bin", "python");

  if (fs.existsSync(pythonExecutable)) {
    return {
      args: ["-m", "dashboard_api"],
      command: pythonExecutable,
      cwd: apiDirectory,
    };
  }

  return {
    args: [
      "-m",
      "uv",
      "run",
      "--project",
      apiDirectory,
      "python",
      "-m",
      "dashboard_api",
    ],
    command: "python",
    cwd: apiDirectory,
  };
}

function getPackagedBackendCommand() {
  return {
    args: [],
    command: path.join(__dirname, "backend", "dashboard-api.exe"),
    cwd: path.join(__dirname, "backend"),
  };
}

function buildBackendEnvironment(githubToken) {
  return {
    ...process.env,
    DASHBOARD_API_PORT: String(backendPort),
    GITHUB_TOKEN: githubToken,
    GITHUB_SESSION_KEY_PATH: getBackendSessionKeyFilePath(),
    GITHUB_SESSION_PATH: getBackendSessionFilePath(),
    ISSUES_DATABASE_PATH: getDatabaseFilePath(),
    PYTHONUTF8: "1",
  };
}

function logChildOutput(stream, prefix) {
  if (!stream) {
    return;
  }

  let bufferedText = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    bufferedText += chunk;

    const lines = bufferedText.split(/\r?\n/u);
    bufferedText = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        writeDesktopLog(`[${prefix}] ${line}`);
      }
    }
  });
  stream.on("end", () => {
    if (bufferedText.trim()) {
      writeDesktopLog(`[${prefix}] ${bufferedText.trim()}`);
    }
  });
}

async function reserveBackendPort() {
  if (backendPort !== null) {
    return backendPort;
  }

  backendPort = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        reject(new Error("Unable to reserve a local backend port."));
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

  return backendPort;
}

async function stopBackendProcess() {
  const processToStop = backendProcess;
  backendReady = false;

  if (!processToStop) {
    return;
  }

  backendProcess = null;

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    processToStop.once("exit", finish);

    if (process.platform === "win32" && processToStop.pid) {
      const killerProcess = spawn(
        "taskkill",
        ["/pid", String(processToStop.pid), "/t", "/f"],
        { windowsHide: true },
      );
      killerProcess.once("exit", () => {
        setTimeout(finish, 250);
      });
      return;
    }

    processToStop.kill("SIGTERM");
    setTimeout(() => {
      processToStop.kill("SIGKILL");
      finish();
    }, 5_000).unref();
  });
}

async function waitForUrl(targetUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(targetUrl, {
        cache: "no-store",
      });

      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the timeout is reached.
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  throw new Error(`Timed out while waiting for ${targetUrl}.`);
}

async function launchBackendProcess(forceRestart) {
  await reserveBackendPort();
  if (forceRestart) {
    await stopBackendProcess();
  }

  backendReady = false;
  const githubToken = getStoredGitHubToken();
  const backendCommand = app.isPackaged
    ? getPackagedBackendCommand()
    : getDevelopmentBackendCommand();
  const childProcess = spawn(backendCommand.command, backendCommand.args, {
    cwd: backendCommand.cwd,
    env: buildBackendEnvironment(githubToken),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  writeDesktopLog(
    `[desktop:api] Starting backend process with command ${backendCommand.command}`,
  );
  backendProcess = childProcess;
  logChildOutput(childProcess.stdout, "desktop:api");
  logChildOutput(childProcess.stderr, "desktop:api");
  childProcess.once("exit", (code, signal) => {
    backendReady = false;

    if (backendProcess === childProcess) {
      backendProcess = null;
    }

    writeDesktopLog(
      `[desktop:api] exited with code ${String(code)} signal ${String(signal)}`,
    );
  });

  await waitForUrl(`${getApiBaseUrl()}/health`, BACKEND_HEALTH_TIMEOUT_MS);
  backendReady = true;
}

function startBackendProcess(options = { forceRestart: true }) {
  const { forceRestart } = options;

  if (!forceRestart) {
    if (backendReady && backendProcess) {
      return Promise.resolve();
    }

    if (backendStartupPromise) {
      return backendStartupPromise;
    }
  }

  const startupPromise = launchBackendProcess(forceRestart).finally(() => {
    if (backendStartupPromise === startupPromise) {
      backendStartupPromise = null;
    }
  });

  backendStartupPromise = startupPromise;
  return startupPromise;
}

async function loadFrontend(mainWindowInstance) {
  if (app.isPackaged) {
    writeDesktopLog("[desktop:web] Loading packaged frontend.");
    await mainWindowInstance.loadFile(
      path.join(__dirname, "web", "index.html"),
    );
    return;
  }

  writeDesktopLog("[desktop:web] Waiting for development frontend.");
  await waitForUrl(DEV_FRONTEND_URL, BACKEND_HEALTH_TIMEOUT_MS);
  await mainWindowInstance.loadURL(DEV_FRONTEND_URL);
}

async function createMainWindow() {
  writeDesktopLog("[desktop:window] Creating desktop window.");
  const windowInstance = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: resolveDesktopBackgroundColor("system"),
    frame: false,
    height: 940,
    icon: getDesktopIconPath(),
    minHeight: 760,
    minWidth: 1180,
    show: false,
    title: APP_TITLE,
    width: 1480,
    webPreferences: {
      additionalArguments: [`--api-base-url=${getApiBaseUrl()}`],
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow = windowInstance;
  windowInstance.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      writeDesktopLog(
        `[desktop:web] did-fail-load code=${String(errorCode)} description=${errorDescription} url=${validatedUrl} mainFrame=${String(isMainFrame)}`,
      );
    },
  );
  windowInstance.webContents.on("did-finish-load", () => {
    writeDesktopLog(
      `[desktop:web] did-finish-load url=${windowInstance.webContents.getURL()}`,
    );
  });
  windowInstance.webContents.on("did-navigate", (_event, targetUrl) => {
    writeDesktopLog(`[desktop:web] did-navigate url=${targetUrl}`);
  });
  windowInstance.webContents.on("render-process-gone", (_event, details) => {
    writeDesktopLog(
      `[desktop:web] render-process-gone reason=${details.reason} exitCode=${String(details.exitCode)}`,
    );
  });
  windowInstance.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      writeDesktopLog(
        `[desktop:web:console] level=${String(level)} line=${String(line)} source=${sourceId} message=${message}`,
      );
    },
  );
  windowInstance.once("ready-to-show", () => {
    writeDesktopLog("[desktop:window] Window is ready to show.");
    windowInstance.show();
  });
  windowInstance.on("closed", () => {
    if (mainWindow === windowInstance) {
      mainWindow = null;
    }
  });
  windowInstance.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  windowInstance.maximize();

  await loadFrontend(windowInstance);
}

function registerDesktopIpcHandlers() {
  ipcMain.handle("desktop:get-backend-status", async () => {
    return {
      ready: backendReady,
    };
  });

  ipcMain.handle("desktop:wait-for-backend", async () => {
    if (!hasStoredSession()) {
      return {
        ready: false,
      };
    }

    await startBackendProcess({ forceRestart: false });
    return {
      ready: backendReady,
    };
  });

  ipcMain.handle("desktop:get-session-status", async () => {
    const sessionRecord = getStoredSessionRecord();

    return {
      configured: Boolean(sessionRecord),
      username: sessionRecord?.username ?? null,
    };
  });

  ipcMain.handle("desktop:save-session", async (_event, payload) => {
    const username = String(payload?.username ?? "").trim();

    if (!username) {
      throw new Error("Debes indicar tu usuario de GitHub.");
    }

    const existingRecord = getStoredSessionRecord();
    let githubToken = String(payload?.token ?? "").trim();

    if (!githubToken) {
      if (!existingRecord) {
        throw new Error("Debes introducir un token en la primera sesión.");
      }

      githubToken = decryptSessionToken(existingRecord, unwrapMasterKey);
    }

    const nextRecord = createEncryptedSessionRecord({
      token: githubToken,
      username,
      wrapKey: wrapMasterKey,
    });

    writeSessionRecord(getSessionFilePath(), nextRecord);
    await startBackendProcess({ forceRestart: true });

    return {
      configured: true,
      username,
    };
  });

  ipcMain.handle("desktop:clear-session", async () => {
    clearSessionRecord(getSessionFilePath());
    await stopBackendProcess();

    return {
      configured: false,
      username: null,
    };
  });

  ipcMain.handle("desktop:get-zoom-factor", async () => {
    return mainWindow?.webContents.getZoomFactor() ?? 1;
  });

  ipcMain.handle("desktop:set-zoom-factor", async (_event, factor) => {
    const numericFactor = Number(factor);
    const clampedFactor = Math.min(1.6, Math.max(0.75, numericFactor));

    mainWindow?.webContents.setZoomFactor(clampedFactor);
    return clampedFactor;
  });

  ipcMain.handle("desktop:set-title-bar-theme", async (_event, theme) => {
    mainWindow?.setBackgroundColor(resolveDesktopBackgroundColor(theme));
  });

  ipcMain.handle("desktop:export-database", async () => {
    return exportDatabaseFile();
  });

  ipcMain.handle("desktop:import-database", async () => {
    return importDatabaseFile();
  });

  ipcMain.handle("desktop:minimize-window", async () => {
    mainWindow?.minimize();
  });

  ipcMain.handle("desktop:toggle-maximize-window", async () => {
    if (!mainWindow) {
      return { isMaximized: false };
    }

    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }

    return {
      isMaximized: mainWindow.isMaximized(),
    };
  });

  ipcMain.handle("desktop:close-window", async () => {
    mainWindow?.close();
  });

  ipcMain.handle("desktop:get-window-state", async () => {
    return {
      isMaximized: mainWindow?.isMaximized() ?? false,
    };
  });
}

async function bootstrapDesktopApp() {
  writeDesktopLog("[desktop] Bootstrapping Electron shell.");
  Menu.setApplicationMenu(buildApplicationMenu());
  registerDesktopIpcHandlers();
  await reserveBackendPort();
  await createMainWindow();

  if (hasStoredSession()) {
    void startBackendProcess({ forceRestart: false }).catch((error) => {
      writeDesktopLog("[desktop:api] Backend startup failed.", error);
    });
  }
}

process.on("uncaughtException", (error) => {
  writeDesktopLog("[desktop] Uncaught exception.", error);
});

process.on("unhandledRejection", (reason) => {
  writeDesktopLog("[desktop] Unhandled promise rejection.", reason);
});

if (!app || typeof app.whenReady !== "function") {
  writeDesktopLog(
    "[desktop] Electron runtime is unavailable. Ensure ELECTRON_RUN_AS_NODE is not set.",
  );
  process.exitCode = 1;
} else {
  app.whenReady().then(() => {
    if (process.platform === "win32") {
      app.setAppUserModelId(APP_USER_MODEL_ID);
    }

    void bootstrapDesktopApp().catch((error) => {
      writeDesktopLog("[desktop] Bootstrap failed.", error);
      app.quit();
    });
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });

  app.on("before-quit", () => {
    void stopBackendProcess();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
