const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

export {};

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
} = require("./session-store.js");
const {
  BackendContractError,
  assertCompatibleBackendHealth,
} = require("./backend-health.js");

const APP_TITLE = "Issues Dashboard";
const APP_USER_MODEL_ID = "com.githubissuesdashboard";
const BACKEND_HEALTH_TIMEOUT_MS = 20_000;
const DEFAULT_API_PORT = 8010;
const DEFAULT_BACKGROUND_DARK = "#111827";
const DEFAULT_BACKGROUND_LIGHT = "#f5efe7";
const DEV_FRONTEND_URL = "http://127.0.0.1:3000";
const LOG_MAX_BYTES = 2 * 1024 * 1024;
const MAX_BACKEND_RESTARTS = 3;
const runtimeDirectory = fs.existsSync(path.join(__dirname, "assets"))
  ? __dirname
  : path.resolve(__dirname, "..");

let backendPort = null;
let backendProcess = null;
let backendReady = false;
let backendStartupPromise = null;
let backendRestartAttempts = 0;
let backendStopRequested = false;
let appQuitting = false;
let mainWindow = null;
const runtimeSecret = crypto.randomBytes(32).toString("base64url");

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
  return path.join(runtimeDirectory, "assets", "app-icon.ico");
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

function writeDesktopLog(message: string, error?: unknown) {
  const errorText =
    error instanceof Error ? `\n${error.stack ?? error.message}` : "";
  const logLine = `[${new Date().toISOString()}] ${message}${errorText}\n`;

  try {
    const logPath = getDesktopLogFilePath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    if (fs.existsSync(logPath) && fs.statSync(logPath).size >= LOG_MAX_BYTES) {
      const previousLogPath = `${logPath}.1`;
      fs.rmSync(previousLogPath, { force: true });
      fs.renameSync(logPath, previousLogPath);
    }
    fs.appendFileSync(logPath, logLine);
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

function getPreferencesFilePath() {
  return path.join(app.getPath("userData"), "preferences.json");
}

function getWindowStateFilePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function readWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(getWindowStateFilePath(), "utf8"));
    return {
      height: Math.max(760, Number(state.height) || 940),
      isMaximized: state.isMaximized !== false,
      width: Math.max(1180, Number(state.width) || 1480),
      x: Number.isFinite(state.x) ? state.x : undefined,
      y: Number.isFinite(state.y) ? state.y : undefined,
    };
  } catch {
    return { height: 940, isMaximized: true, width: 1480 };
  }
}

function saveWindowState(windowInstance) {
  const bounds = windowInstance.getNormalBounds();
  const state = {
    ...bounds,
    isMaximized: windowInstance.isMaximized(),
  };
  const statePath = getWindowStateFilePath();
  const temporaryPath = `${statePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(temporaryPath, statePath);
}

function buildBackupExportFileName() {
  const timestamp = new Date()
    .toISOString()
    .replace(/:/gu, "-")
    .replace(/\..+$/u, "");
  return `issues-dashboard-${timestamp}.issues-dashboard-backup`;
}

async function requestLocalApi(endpoint, payload) {
  const response = await fetch(`${getApiBaseUrl()}${endpoint}`, {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
      "X-Dashboard-Runtime-Secret": runtimeSecret,
    },
    method: "POST",
  });
  const responsePayload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = responsePayload?.detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : "El servicio local no pudo completar la operación.",
    );
  }
  return responsePayload;
}

async function exportBackupFile() {
  const saveResult = await dialog.showSaveDialog({
    buttonLabel: "Crear copia",
    defaultPath: path.join(
      app.getPath("documents"),
      buildBackupExportFileName(),
    ),
    filters: [
      {
        extensions: ["issues-dashboard-backup"],
        name: "Copia de Issues Dashboard",
      },
    ],
    properties: ["createDirectory", "showOverwriteConfirmation"],
    title: "Exportar copia completa",
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { cancelled: true, path: null };
  }

  const result = await requestLocalApi("/api/backups/export", {
    path: saveResult.filePath,
  });
  return { cancelled: false, path: result.path };
}

async function importBackupFile() {
  const openResult = await dialog.showOpenDialog({
    buttonLabel: "Seleccionar copia",
    filters: [
      {
        extensions: ["issues-dashboard-backup"],
        name: "Copia de Issues Dashboard",
      },
    ],
    properties: ["openFile"],
    title: "Importar copia completa",
  });

  if (openResult.canceled || openResult.filePaths.length === 0) {
    return { cancelled: true, path: null };
  }

  const [selectedFilePath] = openResult.filePaths;
  if (!selectedFilePath || !fs.existsSync(selectedFilePath)) {
    throw new Error("No se pudo localizar el archivo seleccionado.");
  }

  const inspection = await requestLocalApi("/api/backups/inspect", {
    path: selectedFilePath,
  });
  const currentAccount = getStoredSessionRecord()?.username ?? null;
  const accountWarning =
    inspection.sourceAccount && inspection.sourceAccount !== currentAccount
      ? `\n\nLa copia pertenece a @${inspection.sourceAccount} y la sesión actual es @${currentAccount ?? "desconocida"}.`
      : "";
  const confirmation = await dialog.showMessageBox(mainWindow, {
    buttons: ["Cancelar", "Restaurar copia"],
    cancelId: 0,
    defaultId: 0,
    detail: `Se sustituirán las issues, Pull Requests, notas y ajustes actuales.${accountWarning}\n\nAntes se creará automáticamente una copia de seguridad recuperable.`,
    message: "¿Quieres restaurar esta copia completa?",
    noLink: true,
    title: "Confirmar restauración",
    type: "warning",
  });
  if (confirmation.response !== 1) {
    return { cancelled: true, path: null };
  }

  const result = await requestLocalApi("/api/backups/import", {
    path: selectedFilePath,
  });
  return {
    cancelled: false,
    path: selectedFilePath,
    safetyBackupPath: result.safetyBackupPath,
    sourceAccount: result.sourceAccount,
  };
}

function getApiBaseUrl() {
  return `http://127.0.0.1:${backendPort ?? DEFAULT_API_PORT}`;
}

async function resolveGitHubIdentity(githubToken) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 20_000);
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "User-Agent": "github-issues-dashboard-v3",
      },
      signal: abortController.signal,
    });
    if (!response.ok) {
      throw new Error(
        "GitHub no ha aceptado el token. Comprueba que siga siendo válido.",
      );
    }
    const payload = await response.json();
    const login = String(payload?.login ?? "").trim();
    if (!login) {
      throw new Error("GitHub no ha devuelto un usuario válido.");
    }
    return { login };
  } finally {
    clearTimeout(timeoutId);
  }
}

function encryptSessionToken(token) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "No se puede guardar la sesión porque safeStorage no está disponible en este equipo.",
    );
  }

  return safeStorage.encryptString(token);
}

function decryptSessionTokenBuffer(encryptedToken) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Electron safeStorage is not available on this machine.");
  }

  return safeStorage.decryptString(encryptedToken);
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
    return decryptSessionToken(sessionRecord, decryptSessionTokenBuffer);
  } catch (error) {
    writeDesktopLog(
      "[desktop:session] Unable to decrypt session token.",
      error,
    );
    return "";
  }
}

function hasStoredSession() {
  return Boolean(getStoredGitHubToken().trim());
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

function getDevelopmentBackendCommand(environment) {
  const apiDirectory = path.resolve(runtimeDirectory, "..", "api");
  const { getPythonLaunch } = require(
    path.join(apiDirectory, "scripts", "python-runtime.cjs"),
  );
  return getPythonLaunch(["-m", "dashboard_api"], { env: environment });
}

function getPackagedBackendCommand(environment) {
  const backendDirectory = path.join(runtimeDirectory, "backend");
  return {
    args: [],
    command: path.join(backendDirectory, "dashboard-api.exe"),
    options: { cwd: backendDirectory, env: environment },
  };
}

function buildBackendEnvironment(githubToken) {
  return {
    ...process.env,
    DASHBOARD_API_PORT: String(backendPort),
    DASHBOARD_DESKTOP_MODE: "1",
    DASHBOARD_PREFERENCES_PATH: getPreferencesFilePath(),
    DASHBOARD_RUNTIME_SECRET: runtimeSecret,
    GITHUB_TOKEN: githubToken,
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
  backendStopRequested = true;

  if (!processToStop) {
    return;
  }

  backendProcess = null;

  await new Promise<void>((resolve) => {
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

function probeHttpUrl(targetUrl) {
  return new Promise((resolve) => {
    const request = http.get(targetUrl, (response) => {
      response.resume();
      resolve((response.statusCode ?? 500) < 500);
    });

    request.on("error", () => resolve(false));
    request.setTimeout(3_000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForUrl(targetUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await probeHttpUrl(targetUrl)) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  throw new Error(`Timed out while waiting for ${targetUrl}.`);
}

async function waitForCompatibleBackend(targetUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(targetUrl, {
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) {
        assertCompatibleBackendHealth(await response.json());
        return;
      }
    } catch (error) {
      if (error instanceof BackendContractError) {
        throw error;
      }
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
  backendStopRequested = false;
  const githubToken = getStoredGitHubToken();
  const environment = buildBackendEnvironment(githubToken);
  const backendCommand = app.isPackaged
    ? getPackagedBackendCommand(environment)
    : getDevelopmentBackendCommand(environment);
  const childProcess = spawn(backendCommand.command, backendCommand.args, {
    ...backendCommand.options,
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
    if (
      !backendStopRequested &&
      !appQuitting &&
      hasStoredSession() &&
      backendRestartAttempts < MAX_BACKEND_RESTARTS
    ) {
      backendRestartAttempts += 1;
      const restartDelay = backendRestartAttempts * 1_000;
      setTimeout(() => {
        void startBackendProcess({ forceRestart: false }).catch((error) => {
          writeDesktopLog("[desktop:api] Automatic restart failed.", error);
        });
      }, restartDelay).unref();
    }
  });

  await waitForCompatibleBackend(
    `${getApiBaseUrl()}/health`,
    BACKEND_HEALTH_TIMEOUT_MS,
  );
  backendReady = true;
  backendRestartAttempts = 0;
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
      path.join(runtimeDirectory, "web", "index.html"),
    );
    return;
  }

  writeDesktopLog("[desktop:web] Waiting for development frontend.");
  await waitForUrl(DEV_FRONTEND_URL, BACKEND_HEALTH_TIMEOUT_MS);
  await mainWindowInstance.loadURL(DEV_FRONTEND_URL);
}

async function createMainWindow() {
  writeDesktopLog("[desktop:window] Creating desktop window.");
  const windowState = readWindowState();
  const windowInstance = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: resolveDesktopBackgroundColor("system"),
    frame: false,
    height: windowState.height,
    icon: getDesktopIconPath(),
    minHeight: 760,
    minWidth: 1180,
    show: false,
    title: APP_TITLE,
    width: windowState.width,
    x: windowState.x,
    y: windowState.y,
    webPreferences: {
      additionalArguments: [
        `--api-base-url=${getApiBaseUrl()}`,
        `--runtime-secret=${runtimeSecret}`,
      ],
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
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
  windowInstance.on("close", () => {
    try {
      saveWindowState(windowInstance);
    } catch (error) {
      writeDesktopLog(
        "[desktop:window] Unable to persist window state.",
        error,
      );
    }
  });
  windowInstance.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (windowState.isMaximized) {
    windowInstance.maximize();
  }

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
    const hasToken = Boolean(getStoredGitHubToken().trim());

    return {
      configured: hasToken,
      username: hasToken ? (sessionRecord?.username ?? null) : null,
    };
  });

  ipcMain.handle("desktop:save-session", async (_event, payload) => {
    const existingRecord = getStoredSessionRecord();
    let githubToken = String(payload?.token ?? "").trim();

    if (!githubToken) {
      if (!existingRecord) {
        throw new Error("Debes introducir un token en la primera sesión.");
      }

      try {
        githubToken = decryptSessionToken(
          existingRecord,
          decryptSessionTokenBuffer,
        );
      } catch {
        throw new Error(
          "No se pudo reutilizar el token guardado. Introduce un token de GitHub para volver a guardar la sesión.",
        );
      }
    }

    const identity = await resolveGitHubIdentity(githubToken);
    const nextRecord = createEncryptedSessionRecord({
      encryptString: encryptSessionToken,
      token: githubToken,
      username: identity.login,
    });

    writeSessionRecord(getSessionFilePath(), nextRecord);
    await startBackendProcess({ forceRestart: true });

    return {
      configured: true,
      username: identity.login,
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

  ipcMain.handle("desktop:export-backup", async () => {
    return exportBackupFile();
  });

  ipcMain.handle("desktop:import-backup", async () => {
    return importBackupFile();
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
  if (hasStoredSession()) {
    await startBackendProcess({ forceRestart: false }).catch((error) => {
      writeDesktopLog("[desktop:api] Backend startup failed.", error);
    });
  }
  await createMainWindow();
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
    appQuitting = true;
    void stopBackendProcess();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
