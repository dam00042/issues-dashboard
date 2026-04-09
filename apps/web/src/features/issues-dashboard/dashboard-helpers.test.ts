import { describe, expect, it } from "vitest";

import {
  buildSyncPayload,
  defaultNoteBlocks,
  filterIssuesBySearch,
  normalizeNoteBlocks,
  sortIssuesByPinnedAndUpdated,
} from "./dashboard-helpers";
import type { DashboardIssue, IssueLocalState, NoteBlock } from "./types";

function createLocalState(
  overrides: Partial<IssueLocalState> = {},
): IssueLocalState {
  return {
    isPinned: false,
    lastInteractedAt: "2026-04-01T12:00:00.000Z",
    lastPinnedBeforeCompletion: false,
    lastPriorityBeforeCompletion: null,
    localCompletedAt: null,
    noteBlocks: defaultNoteBlocks(),
    priority: null,
    ...overrides,
  };
}

function createIssue(
  issueKey: string,
  overrides: Partial<DashboardIssue> = {},
): DashboardIssue {
  const numericId = Number.parseInt(issueKey.replace(/\D/g, ""), 10) || 1;

  return {
    body: "",
    closedAt: null,
    createdAt: "2026-03-28T10:00:00.000Z",
    firstSeenAt: "2026-03-28T10:00:00.000Z",
    githubId: numericId,
    htmlUrl: `https://github.com/example/repo/issues/${numericId}`,
    issueKey,
    localState: createLocalState(),
    number: numericId,
    remoteState: "open",
    repository: {
      fullName: "example/repo",
      name: "repo",
      ownerAvatarUrl: "https://avatars.githubusercontent.com/u/1",
      ownerLogin: "example",
    },
    syncedAt: "2026-04-01T12:00:00.000Z",
    title: "Improve issue dashboard",
    updatedAt: "2026-04-01T11:00:00.000Z",
    ...overrides,
  };
}

describe("issue helpers", () => {
  it("normalizes legacy note blocks into the two fixed sections", () => {
    const legacyBlocks = [
      {
        id: "legacy-context",
        items: [],
        kind: "text",
        label: "Contexto actual",
        text: "Primero\nSegundo",
      },
      {
        id: "legacy-checklist",
        items: [
          {
            checked: true,
            id: "item-1",
            text: "Confirmar logs",
          },
        ],
        kind: "checklist",
        label: "Checklist",
        text: "",
      },
    ] as NoteBlock[];

    const normalizedBlocks = normalizeNoteBlocks(legacyBlocks);

    expect(normalizedBlocks).toHaveLength(2);
    expect(normalizedBlocks[0]?.label).toBe("Contexto");
    expect(normalizedBlocks[0]?.items.map((item) => item.text)).toEqual([
      "Primero",
      "Segundo",
    ]);
    expect(normalizedBlocks[1]?.label).toBe("Siguientes pasos");
    expect(normalizedBlocks[1]?.items[0]?.kind).toBe("checklist");
  });

  it("filters issues by title, repository and number", () => {
    const issues = [
      createIssue("repo-42", { title: "Fix auth flow" }),
      createIssue("repo-77", {
        repository: {
          fullName: "acme/platform",
          name: "platform",
          ownerAvatarUrl: "https://avatars.githubusercontent.com/u/2",
          ownerLogin: "acme",
        },
        title: "Improve reports",
      }),
    ];

    expect(filterIssuesBySearch(issues, "auth")).toHaveLength(1);
    expect(filterIssuesBySearch(issues, "platform")).toHaveLength(1);
    expect(filterIssuesBySearch(issues, "77")).toHaveLength(1);
  });

  it("sorts pinned issues before recent issues", () => {
    const issues = [
      createIssue("repo-1", {
        localState: createLocalState({ isPinned: false }),
        updatedAt: "2026-04-01T10:00:00.000Z",
      }),
      createIssue("repo-2", {
        localState: createLocalState({ isPinned: true }),
        updatedAt: "2026-03-30T10:00:00.000Z",
      }),
    ];

    const sortedIssues = sortIssuesByPinnedAndUpdated(issues);

    expect(sortedIssues[0]?.issueKey).toBe("repo-2");
    expect(sortedIssues[1]?.issueKey).toBe("repo-1");
  });

  it("builds sync payload only for dirty issues", () => {
    const dirtyState = createLocalState({ priority: 2 });
    const issues = [
      createIssue("repo-11", {
        githubId: 11,
        localState: createLocalState({ priority: 4 }),
      }),
      createIssue("repo-22", {
        githubId: 22,
        localState: dirtyState,
      }),
    ];

    const payload = buildSyncPayload(issues, ["repo-22"]);

    expect(payload).toEqual([
      {
        githubId: 22,
        issueKey: "repo-22",
        issueNumber: 22,
        repoFullName: "example/repo",
        repoName: "repo",
        state: dirtyState,
      },
    ]);
  });
});
