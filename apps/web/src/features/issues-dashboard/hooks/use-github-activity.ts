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
  const [loadedPullRequestWindow, setLoadedPullRequestWindow] =
    useState<PullRequestWindowOption | null>(null);
  const [pullRequestsRefreshedAt, setPullRequestsRefreshedAt] = useState<
    string | null
  >(null);
  const pullRequestRequestIdRef = useRef(0);

  const requestPullRequests = useCallback(async () => {
    const requestId = pullRequestRequestIdRef.current + 1;
    pullRequestRequestIdRef.current = requestId;
    setIsFetchingPullRequests(true);
    try {
      const dashboard = await getPullRequestDashboard(pullRequestWindow);
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
      if (requestId === pullRequestRequestIdRef.current) {
        setLoadedPullRequestWindow(pullRequestWindow);
        setIsFetchingPullRequests(false);
      }
    }
  }, [pullRequestWindow]);

  const refreshPullRequests = useCallback(
    () => requestPullRequests(),
    [requestPullRequests],
  );
  const visiblePullRequests = useMemo(
    () => filterPullRequestsByWindow(pullRequests, pullRequestWindow),
    [pullRequests, pullRequestWindow],
  );

  useEffect(() => {
    if (!enabled || loadedPullRequestWindow === pullRequestWindow) return;
    void requestPullRequests();
  }, [
    enabled,
    loadedPullRequestWindow,
    pullRequestWindow,
    requestPullRequests,
  ]);

  const hasLoadedPullRequests = loadedPullRequestWindow === pullRequestWindow;

  return {
    hasLoadedPullRequests,
    isFetchingPullRequests,
    pullRequestWarning,
    pullRequests: visiblePullRequests,
    pullRequestsRefreshedAt,
    refreshPullRequests,
  };
}
