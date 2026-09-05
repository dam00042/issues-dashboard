import { describe, expect, it } from "vitest";

import { filterPullRequestsByWindow } from "@/features/issues-dashboard/utils/pull-request-window";

const NOW = new Date("2026-09-05T12:00:00Z");
const PULL_REQUESTS = [
  { id: "today", updatedAt: "2026-09-05T08:00:00Z" },
  { id: "this-week", updatedAt: "2026-09-01T12:00:00Z" },
  { id: "last-month", updatedAt: "2026-08-05T12:00:00Z" },
  { id: "older", updatedAt: "2026-08-05T11:59:59Z" },
  { id: "unknown", updatedAt: null },
];

describe("filterPullRequestsByWindow", () => {
  it("filters a previously loaded history when the visible window shrinks", () => {
    expect(
      filterPullRequestsByWindow(PULL_REQUESTS, "7d", NOW).map(
        (pullRequest) => pullRequest.id,
      ),
    ).toEqual(["today", "this-week"]);
  });

  it("uses calendar months and includes the exact cutoff", () => {
    expect(
      filterPullRequestsByWindow(PULL_REQUESTS, "1m", NOW).map(
        (pullRequest) => pullRequest.id,
      ),
    ).toEqual(["today", "this-week", "last-month"]);
  });
});
