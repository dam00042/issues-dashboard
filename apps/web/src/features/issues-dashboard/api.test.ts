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
          username: "octocat",
        }),
        waitForBackendReady,
      },
    });

    await expect(waitForLocalSessionStatus(100)).resolves.toEqual({
      configured: true,
      username: "octocat",
    });
    expect(waitForBackendReady).toHaveBeenCalledOnce();
  });

  it("saves and clears the desktop session through Electron IPC", async () => {
    const saveSession = vi.fn().mockResolvedValue({
      configured: true,
      username: "octocat",
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
      }),
    ).resolves.toEqual({
      configured: true,
      username: "octocat",
    });
    await expect(clearLocalSession()).resolves.toEqual({
      configured: false,
      username: null,
    });
    expect(saveSession).toHaveBeenCalledWith({
      token: "ghp_test",
    });
    expect(clearSession).toHaveBeenCalledOnce();
  });
});
