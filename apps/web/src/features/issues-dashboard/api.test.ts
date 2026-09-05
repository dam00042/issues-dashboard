import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearLocalSession,
  saveLocalSession,
  waitForLocalSessionStatus,
} from "./api";

describe("Electron session API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows session setup without waiting for a backend when unconfigured", async () => {
    const waitForBackendReady = vi.fn();
    vi.stubGlobal("window", {
      githubIssuesDesktop: {
        getSessionStatus: vi.fn().mockResolvedValue({
          configured: false,
          username: null,
        }),
        waitForBackendReady,
      },
    });

    await expect(waitForLocalSessionStatus(100)).resolves.toEqual({
      configured: false,
      username: null,
    });
    expect(waitForBackendReady).not.toHaveBeenCalled();
  });

  it("waits for the isolated Electron backend when a session exists", async () => {
    const waitForBackendReady = vi.fn().mockResolvedValue({ ready: true });
    vi.stubGlobal("window", {
      githubIssuesDesktop: {
        getSessionStatus: vi.fn().mockResolvedValue({
          configured: true,
          username: "DAM6628_cemosa",
        }),
        waitForBackendReady,
      },
    });

    await expect(waitForLocalSessionStatus(100)).resolves.toEqual({
      configured: true,
      username: "DAM6628_cemosa",
    });
    expect(waitForBackendReady).toHaveBeenCalledOnce();
  });

  it("saves and clears the desktop session through Electron IPC", async () => {
    const saveSession = vi.fn().mockResolvedValue({
      configured: true,
      username: "DAM6628_cemosa",
    });
    const clearSession = vi.fn().mockResolvedValue({
      configured: false,
      username: null,
    });
    vi.stubGlobal("window", {
      githubIssuesDesktop: { clearSession, saveSession },
    });

    await expect(
      saveLocalSession({
        token: "ghp_test",
        username: "DAM6628_cemosa",
      }),
    ).resolves.toEqual({
      configured: true,
      username: "DAM6628_cemosa",
    });
    await expect(clearLocalSession()).resolves.toEqual({
      configured: false,
      username: null,
    });
    expect(saveSession).toHaveBeenCalledWith({
      token: "ghp_test",
      username: "DAM6628_cemosa",
    });
    expect(clearSession).toHaveBeenCalledOnce();
  });
});
