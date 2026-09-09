import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearLocalSession,
  getIssueDetail,
  getIssuesSnapshot,
  saveLocalSession,
  syncIssueStates,
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

  it("loads compact snapshots and safely encodes issue detail URLs", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", {
      githubIssuesDesktop: {
        apiBaseUrl: "http://127.0.0.1:17632",
        runtimeSecret: "test-runtime-secret",
      },
    });

    await getIssuesSnapshot("1m");
    await getIssueDetail("example/repo#42");

    const [snapshotUrl, snapshotOptions] = fetch.mock.calls[0];
    expect(snapshotUrl.href).toBe(
      "http://127.0.0.1:17632/api/issues/snapshot?closed_window=1m&compact=true",
    );
    expect(snapshotOptions.cache).toBe("no-store");
    expect(snapshotOptions.headers.get("X-Dashboard-Runtime-Secret")).toBe(
      "test-runtime-secret",
    );
    expect(fetch.mock.calls[1][0]).toBe(
      "http://127.0.0.1:17632/api/issues/example/repo%2342",
    );
  });

  it("persists review status while leaving unloaded notes untouched", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"updated":1}'));
    vi.stubGlobal("fetch", fetch);
    const states = [
      {
        githubId: 42,
        issueKey: "example/repo#42",
        issueNumber: 42,
        repoFullName: "example/repo",
        repoName: "repo",
        state: {
          isPinned: false,
          lastInteractedAt: "2026-04-01T12:00:00.000Z",
          lastPinnedBeforeCompletion: false,
          lastPriorityBeforeCompletion: null,
          localCompletedAt: null,
          priority: null,
          status: "in_review" as const,
        },
      },
    ];

    await expect(syncIssueStates(states)).resolves.toBe(1);

    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload).toEqual({ states });
    expect(payload.states[0].state).not.toHaveProperty("noteBlocks");
  });
});
