import { describe, expect, it, vi } from "vitest";
import { PROJECT_STATUS_DEFINITIONS } from "@/features/issues-dashboard/project-statuses";
import type {
  DashboardIssue,
  IssueLocalState,
  NoteBlock,
} from "@/features/issues-dashboard/types";
import {
  buildProjectFilterDefinitions,
  buildSyncPayload,
  defaultNoteBlocks,
  filterIssuesBySearch,
  issueMatchesProjectFilters,
  issueMatchesRemoteState,
  normalizeNoteBlocks,
  sortIssuesByPinnedAndUpdated,
} from "./dashboard-helpers";
import {
  flushMissingIssueStates,
  getStableIssueKeys,
  reconcileIssue,
} from "./issue-state";

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
    status: "active",
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
    detailsLoaded: false,
    firstSeenAt: "2026-03-28T10:00:00.000Z",
    githubId: numericId,
    htmlUrl: `https://github.com/example/repo/issues/${numericId}`,
    issueKey,
    localState: createLocalState(),
    number: numericId,
    projectItems: [],
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
  it("keeps loaded detail when an unchanged compact snapshot arrives", () => {
    const current = createIssue("example/repo#1", {
      body: "Cached detail",
      detailsLoaded: true,
    });
    current.localState.noteBlocks[0].items[0].text = "Keep this note";
    const compact = createIssue(current.issueKey);

    const result = reconcileIssue(compact, current);

    expect(result.detailsLoaded).toBe(true);
    expect(result.body).toBe("Cached detail");
    expect(result.localState.noteBlocks).toBe(current.localState.noteBlocks);
  });

  it("keeps a confirmed local edit when an older read finishes later", () => {
    const current = createIssue("example/repo#1", {
      localState: createLocalState({
        status: "in_review",
        priority: 2,
        lastInteractedAt: "2026-04-01T12:01:00.000Z",
      }),
    });

    const result = reconcileIssue(createIssue(current.issueKey), current);

    expect(result.localState.status).toBe("in_review");
    expect(result.localState.priority).toBe(2);
  });

  it("loads persisted notes into a compact issue with a pending priority edit", () => {
    const current = createIssue("example/repo#1", {
      localState: createLocalState({ priority: 2 }),
    });
    const detail = createIssue(current.issueKey, { detailsLoaded: true });
    detail.localState.noteBlocks[0].items[0].text = "Saved note";

    const result = reconcileIssue(detail, current, { dirty: true });

    expect(result.localState.priority).toBe(2);
    expect(result.localState.noteBlocks[0].items[0].text).toBe("Saved note");
  });

  it("invalidates remote detail while retaining unsaved notes", () => {
    const current = createIssue("example/repo#1", { detailsLoaded: true });
    current.localState.noteBlocks[0].items[0].text = "Pending note";
    const incoming = createIssue(current.issueKey, {
      syncedAt: "2026-04-01T13:00:00.000Z",
    });

    const result = reconcileIssue(incoming, current, {
      dirty: true,
      dirtyNotes: true,
    });

    expect(result.detailsLoaded).toBe(false);
    expect(result.localState.noteBlocks).toBe(current.localState.noteBlocks);
  });

  it("keeps confirmed notes when an older detail arrives after invalidation", () => {
    const current = createIssue("example/repo#1", {
      detailsLoaded: true,
      localState: createLocalState({
        lastInteractedAt: "2026-04-01T12:01:00.000Z",
      }),
    });
    current.localState.noteBlocks[0].items[0].text = "Latest saved note";
    const invalidated = reconcileIssue(
      createIssue(current.issueKey, {
        syncedAt: "2026-04-01T13:00:00.000Z",
      }),
      current,
      { dirty: true, dirtyNotes: true },
    );
    expect(invalidated.detailsLoaded).toBe(false);

    const staleDetail = createIssue(current.issueKey, { detailsLoaded: true });
    staleDetail.localState.noteBlocks[0].items[0].text = "Previous note";
    const result = reconcileIssue(staleDetail, invalidated);

    expect(result.localState.noteBlocks).toBe(current.localState.noteBlocks);
    expect(
      buildSyncPayload([result], [result.issueKey])[0].state.noteBlocks,
    ).toBe(current.localState.noteBlocks);
  });

  it("waits for a filtered-out issue to be saved before replacing its snapshot", async () => {
    const issue = createIssue("example/repo#1", { detailsLoaded: true });
    issue.localState.noteBlocks[0].items[0].text = "Pending note";
    const pendingVersions = new Map([[issue.issueKey, 1]]);
    let visibleIssues = [issue];
    let completeWrite: () => void = () => {};
    const writeFinished = new Promise<void>((resolve) => {
      completeWrite = resolve;
    });
    const writes: ReturnType<typeof buildSyncPayload>[] = [];
    const applyingSnapshot = flushMissingIssueStates(
      [],
      pendingVersions,
      async () => {
        writes.push(buildSyncPayload(visibleIssues, pendingVersions.keys()));
        await writeFinished;
        pendingVersions.clear();
      },
    ).then(() => {
      visibleIssues = [];
    });
    await Promise.resolve();
    expect(visibleIssues).toEqual([issue]);

    completeWrite();
    await applyingSnapshot;

    expect(writes[0][0].state.noteBlocks?.[0].items[0].text).toBe(
      "Pending note",
    );
    expect(pendingVersions.size).toBe(0);
    expect(visibleIssues).toEqual([]);
  });

  it("keeps the old snapshot when a filtered-out edit cannot be saved", async () => {
    const issue = createIssue("example/repo#1");
    const pendingVersions = new Map([[issue.issueKey, 1]]);
    let visibleIssues = [issue];
    const applyingSnapshot = flushMissingIssueStates([], pendingVersions, () =>
      Promise.reject(new Error("Local service unavailable")),
    ).then(() => {
      visibleIssues = [];
    });

    await expect(applyingSnapshot).rejects.toThrow("Local service unavailable");
    expect(visibleIssues).toEqual([issue]);
    expect(pendingVersions.has(issue.issueKey)).toBe(true);
  });

  it("does not delay a snapshot for edits that can be reconciled in place", async () => {
    const issue = createIssue("example/repo#1");
    const flush = vi.fn(async () => {});

    await flushMissingIssueStates(
      [issue],
      new Map([[issue.issueKey, 1]]),
      flush,
    );

    expect(flush).not.toHaveBeenCalled();
  });

  it("does not acknowledge a second edit made while the first was saving", () => {
    const submitted = new Map([
      ["example/repo#1", 1],
      ["example/repo#2", 2],
    ]);
    const current = new Map([
      ["example/repo#1", 3],
      ["example/repo#2", 2],
    ]);

    expect(getStableIssueKeys(submitted, current)).toEqual(["example/repo#2"]);
  });

  it("accepts an older restored state without reusing cached detail or notes", () => {
    const current = createIssue("example/repo#1", {
      body: "Current detail",
      detailsLoaded: true,
      localState: createLocalState({
        lastInteractedAt: "2026-04-01T12:01:00.000Z",
        priority: 4,
        status: "in_review",
      }),
    });
    current.localState.noteBlocks[0].items[0].text = "Current note";
    const restored = createIssue(current.issueKey);

    const result = reconcileIssue(restored, current, {
      replaceLocalState: true,
    });

    expect(result).toMatchObject(restored);
    expect(result.notesLoaded).toBe(false);
  });

  it("retains edits made while a restored snapshot is loading", () => {
    const current = createIssue("example/repo#1", {
      localState: createLocalState({ priority: 4 }),
    });
    current.localState.noteBlocks[0].items[0].text = "New note";

    const result = reconcileIssue(createIssue(current.issueKey), current, {
      dirty: true,
      dirtyNotes: true,
      replaceLocalState: true,
    });

    expect(result.localState.priority).toBe(4);
    expect(result.localState.noteBlocks).toBe(current.localState.noteBlocks);
  });

  it("keeps the complete canonical Project status workflow in a fixed order", () => {
    expect(
      PROJECT_STATUS_DEFINITIONS.map((definition) => definition.label),
    ).toEqual([
      "Backlog",
      "To Do",
      "Stopped",
      "In Progress",
      "In Review",
      "Approved",
      "Develop",
      "Integration (QA)",
      "Production",
      "Done",
      "Second Life",
    ]);
  });

  it("defaults the first next-action line to checklist mode", () => {
    const blocks = defaultNoteBlocks();

    expect(blocks[0]?.items[0]?.kind).toBe("text");
    expect(blocks[1]?.items[0]?.kind).toBe("checklist");
  });

  it("upgrades the old blank next-action default to checklist mode", () => {
    const legacyBlocks = defaultNoteBlocks();
    const nextActionItem = legacyBlocks[1]?.items[0];

    if (!nextActionItem)
      throw new Error("Expected a next-action item fixture.");
    nextActionItem.kind = "text";

    const normalizedBlocks = normalizeNoteBlocks(legacyBlocks);

    expect(normalizedBlocks[1]?.items[0]?.kind).toBe("checklist");
  });

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
    ] as unknown as NoteBlock[];

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

  it("keeps the GitHub open and closed state filter independent", () => {
    const openIssue = createIssue("repo-42", { remoteState: "open" });
    const closedIssue = createIssue("repo-77", { remoteState: "closed" });

    expect(issueMatchesRemoteState(openIssue, "open")).toBe(true);
    expect(issueMatchesRemoteState(closedIssue, "open")).toBe(false);
    expect(issueMatchesRemoteState(closedIssue, "closed")).toBe(true);
    expect(issueMatchesRemoteState(openIssue, "all")).toBe(true);
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
        detailsLoaded: true,
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

  it("preserves unloaded notes by omitting them from local state writes", () => {
    const issue = createIssue("repo-22");
    const [payload] = buildSyncPayload([issue], [issue.issueKey]);

    expect(payload?.state).not.toHaveProperty("noteBlocks");
    expect(payload?.state.status).toBe("active");
  });

  it("includes notes explicitly edited before detail loading completes", () => {
    const issue = createIssue("repo-22");
    const [payload] = buildSyncPayload(
      [issue],
      [issue.issueKey],
      new Set([issue.issueKey]),
    );

    expect(payload?.state.noteBlocks).toEqual(issue.localState.noteBlocks);
  });

  it("builds dynamic GitHub Project filters and matches their values", () => {
    const projectItems = [
      {
        fields: [
          {
            fieldId: "status-field",
            fieldName: "Status",
            kind: "single_select" as const,
            value: "In Review",
          },
          {
            fieldId: "status-field-in-review-decorated",
            fieldName: "Status",
            kind: "single_select" as const,
            value: "👀 In review",
          },
          {
            fieldId: "status-field-in-progress",
            fieldName: "Status",
            kind: "single_select" as const,
            value: "🏗 In Progress",
          },
          {
            fieldId: "status-field-in-progress-plain",
            fieldName: "Status",
            kind: "single_select" as const,
            value: "In progress",
          },
          {
            fieldId: "status-field-backlog",
            fieldName: "Status",
            kind: "single_select" as const,
            value: "📋 Backlog",
          },
          {
            fieldId: "status-field-backlog-plain",
            fieldName: "Status",
            kind: "single_select" as const,
            value: "Backlog",
          },
          {
            fieldId: "status-field-done-decorated",
            fieldName: "Status",
            kind: "single_select" as const,
            value: "🌐 Done",
          },
          {
            fieldId: "status-field-done-plain",
            fieldName: "Status",
            kind: "single_select" as const,
            value: "Done",
          },
          {
            fieldId: "status-field-stopped",
            fieldName: "Status",
            kind: "single_select" as const,
            value: "⛔ Stopped",
          },
          {
            fieldId: "status-field-to-do",
            fieldName: "Status",
            kind: "single_select" as const,
            value: "📝 TO DO",
          },
          {
            fieldId: "status-field-approved",
            fieldName: "Status",
            kind: "single_select" as const,
            value: "🔖 Approved",
          },
          {
            fieldId: "status-field-production",
            fieldName: "Status",
            kind: "single_select" as const,
            value: "🔖 Production",
          },
          {
            fieldId: "status-field-develop",
            fieldName: "Status",
            kind: "single_select" as const,
            value: "🚀 Develop",
          },
          {
            fieldId: "sprint-field",
            fieldName: "Sprint",
            kind: "iteration" as const,
            value: "Sprint 8",
          },
          {
            fieldId: "priority-field",
            fieldName: "Priority",
            kind: "single_select" as const,
            value: "High",
          },
        ],
        projectId: "project-1",
        projectNumber: 3,
        projectTitle: "Roadmap",
        projectUrl: "https://github.com/orgs/example/projects/3",
      },
    ];
    const issues = [createIssue("repo-99", { projectItems })];
    const issue = issues[0];
    if (!issue) throw new Error("Expected a project issue fixture.");

    const definitions = buildProjectFilterDefinitions(issues);

    expect(definitions.map((definition) => definition.label)).toEqual([
      "Status de Projects",
      "Sprint",
      "Priority",
    ]);
    expect(
      definitions.find((definition) => definition.key === "status")?.options,
    ).toEqual([
      "Backlog",
      "To Do",
      "Stopped",
      "In Progress",
      "In Review",
      "Approved",
      "Develop",
      "Production",
      "Done",
    ]);
    expect(
      definitions.find((definition) => definition.key === "sprint")?.options,
    ).toEqual(["Sprint 8 (Current)"]);
    expect(
      definitions.find((definition) => definition.key === "priority")?.options,
    ).toEqual(["Critical", "High", "Medium", "Low"]);
    expect(
      issueMatchesProjectFilters(issue, {
        status: "In Review",
      }),
    ).toBe(true);
    expect(
      issueMatchesProjectFilters(issue, {
        status: "In Progress",
      }),
    ).toBe(true);
    expect(
      issueMatchesProjectFilters(issue, {
        status: "Backlog",
      }),
    ).toBe(true);
    expect(
      issueMatchesProjectFilters(issue, {
        priority: "Low",
      }),
    ).toBe(false);
    expect(
      issueMatchesProjectFilters(issue, {
        sprint: "Sprint 8 (Current)",
      }),
    ).toBe(true);
  });

  it("sorts sprints newest first using their numeric suffix", () => {
    const issue = createIssue("repo-sprints", {
      projectItems: [
        {
          fields: ["Sprint 9", "Sprint 36", "Sprint 10"].map(
            (value, index) => ({
              fieldId: `sprint-${String(index)}`,
              fieldName: "Sprint",
              kind: "iteration" as const,
              value,
            }),
          ),
          projectId: "project-sprints",
          projectNumber: 1,
          projectTitle: "Roadmap",
          projectUrl: "https://github.com/orgs/example/projects/1",
        },
      ],
    });

    expect(buildProjectFilterDefinitions([issue])[0]?.options).toEqual([
      "Sprint 36 (Current)",
      "Sprint 10",
      "Sprint 9",
    ]);
  });
});
