export interface DesktopSessionStatus {
  configured: boolean;
  username: string | null;
}

export interface DesktopSessionPayload {
  username: string;
  token?: string;
}

export interface DesktopWindowState {
  isMaximized: boolean;
}

export interface DesktopBackendStatus {
  ready: boolean;
}

export interface DesktopDatabaseTransferResult {
  cancelled: boolean;
  path: string | null;
}

export type ThemeMode = "system" | "light" | "dark";

export interface DesktopBridge {
  apiBaseUrl?: string;
  isElectron: boolean;
  getSessionStatus?: () => Promise<DesktopSessionStatus>;
  saveSession?: (
    payload: DesktopSessionPayload,
  ) => Promise<DesktopSessionStatus>;
  clearSession?: () => Promise<DesktopSessionStatus>;
  getZoomFactor?: () => Promise<number>;
  setZoomFactor?: (factor: number) => Promise<number>;
  setTitleBarTheme?: (theme: ThemeMode) => Promise<void>;
  minimizeWindow?: () => Promise<void>;
  toggleMaximizeWindow?: () => Promise<DesktopWindowState>;
  closeWindow?: () => Promise<void>;
  getWindowState?: () => Promise<DesktopWindowState>;
  getBackendStatus?: () => Promise<DesktopBackendStatus>;
  waitForBackendReady?: () => Promise<DesktopBackendStatus>;
  exportDatabase?: () => Promise<DesktopDatabaseTransferResult>;
  importDatabase?: () => Promise<DesktopDatabaseTransferResult>;
}

declare global {
  interface Window {
    githubIssuesDesktop?: DesktopBridge;
  }
}
