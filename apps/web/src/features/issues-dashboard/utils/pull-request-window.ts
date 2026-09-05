import { subDays, subMonths, subYears } from "date-fns";

import type {
  GitHubPullRequest,
  PullRequestWindowOption,
} from "@/features/issues-dashboard/types";

function getPullRequestWindowCutoff(
  windowOption: PullRequestWindowOption,
  now: Date,
): Date {
  const amount = Number.parseInt(windowOption.slice(0, -1), 10);
  const unit = windowOption.at(-1);
  if (unit === "d") return subDays(now, amount);
  if (unit === "y") return subYears(now, amount);
  return subMonths(now, amount);
}

export function filterPullRequestsByWindow<
  PullRequest extends Pick<GitHubPullRequest, "updatedAt">,
>(
  pullRequests: readonly PullRequest[],
  windowOption: PullRequestWindowOption,
  now = new Date(),
): PullRequest[] {
  const cutoffTimestamp = getPullRequestWindowCutoff(
    windowOption,
    now,
  ).getTime();
  return pullRequests.filter((pullRequest) => {
    if (!pullRequest.updatedAt) return false;
    const updatedTimestamp = Date.parse(pullRequest.updatedAt);
    return (
      Number.isFinite(updatedTimestamp) && updatedTimestamp >= cutoffTimestamp
    );
  });
}
