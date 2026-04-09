const { contextBridge, ipcRenderer } = require("electron");

function getArgumentValue(name, fallbackValue) {
  const prefix = `--${name}=`;
  const matchedArgument = process.argv.find((argument) =>
    argument.startsWith(prefix),
  );

  if (!matchedArgument) {
    return fallbackValue;
  }

  return matchedArgument.slice(prefix.length);
}

contextBridge.exposeInMainWorld("githubIssuesDesktop", {
  apiBaseUrl: getArgumentValue("api-base-url", "http://127.0.0.1:8010"),
  clearSession: () => ipcRenderer.invoke("desktop:clear-session"),
  closeWindow: () => ipcRenderer.invoke("desktop:close-window"),
  exportDatabase: () => ipcRenderer.invoke("desktop:export-database"),
  getBackendStatus: () => ipcRenderer.invoke("desktop:get-backend-status"),
  getSessionStatus: () => ipcRenderer.invoke("desktop:get-session-status"),
  getWindowState: () => ipcRenderer.invoke("desktop:get-window-state"),
  getZoomFactor: () => ipcRenderer.invoke("desktop:get-zoom-factor"),
  importDatabase: () => ipcRenderer.invoke("desktop:import-database"),
  isElectron: true,
  minimizeWindow: () => ipcRenderer.invoke("desktop:minimize-window"),
  saveSession: (payload) => ipcRenderer.invoke("desktop:save-session", payload),
  setTitleBarTheme: (theme) =>
    ipcRenderer.invoke("desktop:set-title-bar-theme", theme),
  setZoomFactor: (factor) =>
    ipcRenderer.invoke("desktop:set-zoom-factor", factor),
  toggleMaximizeWindow: () =>
    ipcRenderer.invoke("desktop:toggle-maximize-window"),
  waitForBackendReady: () => ipcRenderer.invoke("desktop:wait-for-backend"),
});
