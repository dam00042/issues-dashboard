"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getPullRequestDashboard } from "@/features/issues-dashboard/api";
import type {
  GitHubPullRequest,
  PullRequestWindowOption,
} from "@/features/issues-dashboard/types";
import { filterPullRequestsByWindow } from "@/features/issues-dashboard/utils/pull-request-window";

export function useGitHubActivity({
  enabled,
  pullRequestWindow,
}: {
  enabled: boolean;
  pullRequestWindow: PullRequestWindowOption;
}) {
  const [pullRequests, setPullRequests] = useState<GitHubPullRequest[]>([]);
  const [pullRequestWarning, setPullRequestWarning] = useState("");
  const [isFetchingPullRequests, setIsFetchingPullRequests] = useState(false);
  const [pullRequestsRefreshedAt, setPullRequestsRefreshedAt] = useState<
    string | null
  >(null);
  const pullRequestRequestIdRef = useRef(0);

  const requestPullRequests = useCallback(
    async (refresh: boolean) => {
      if (!enabled) return;
      const requestId = pullRequestRequestIdRef.current + 1;
      pullRequestRequestIdRef.current = requestId;
      if (refresh) setIsFetchingPullRequests(true);
      try {
        const dashboard = await getPullRequestDashboard(
          pullRequestWindow,
          refresh,
        );
        if (requestId !== pullRequestRequestIdRef.current) return;
        setPullRequests(dashboard.pullRequests);
        setPullRequestWarning(dashboard.warning ?? "");
        setPullRequestsRefreshedAt(dashboard.refreshedAt);
      } catch (error) {
        if (requestId !== pullRequestRequestIdRef.current) return;
        setPullRequestWarning(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar las Pull Requests.",
        );
      } finally {
        if (refresh && requestId === pullRequestRequestIdRef.current) {
          setIsFetchingPullRequests(false);
        }
      }
    },
    [enabled, pullRequestWindow],
  );

  const refreshPullRequests = useCallback(
    () => requestPullRequests(true),
    [requestPullRequests],
  );
  const visiblePullRequests = useMemo(
    () => filterPullRequestsByWindow(pullRequests, pullRequestWindow),
    [pullRequests, pullRequestWindow],
  );

  useEffect(() => {
    if (!enabled) return;
    void requestPullRequests(false);
  }, [enabled, requestPullRequests]);

  return {
    isFetchingPullRequests,
    pullRequestWarning,
    pullRequests: visiblePullRequests,
    pullRequestsRefreshedAt,
    refreshPullRequests,
  };
}
