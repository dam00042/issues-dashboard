import { describe, expect, it } from "vitest";
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
