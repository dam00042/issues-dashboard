export interface DesktopSessionStatus {
  configured: boolean;
  username: string | null;
}

export interface DesktopSessionPayload {
  token?: string;
}

export interface DesktopWindowState {
  isMaximized: boolean;
}

export interface DesktopBackendStatus {
  ready: boolean;
}

export interface DesktopBackupTransferResult {
  cancelled: boolean;
  path: string | null;
  safetyBackupPath?: string;
  sourceAccount?: string | null;
}

export type ThemeMode = "system" | "light" | "dark";

export interface DesktopBridge {
  apiBaseUrl?: string;
  runtimeSecret?: string;
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
  exportBackup?: () => Promise<DesktopBackupTransferResult>;
  importBackup?: () => Promise<DesktopBackupTransferResult>;
}

declare global {
  interface Window {
    githubIssuesDesktop?: DesktopBridge;
  }
}
