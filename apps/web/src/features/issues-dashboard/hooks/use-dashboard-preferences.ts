"use client";

import { useCallback, useEffect, useState } from "react";

import {
  getDashboardPreferences,
  saveDashboardPreferences,
} from "@/features/issues-dashboard/api";
import type { DashboardPreferences } from "@/features/issues-dashboard/types";

export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = {
  autoRefresh: { amount: 5, enabled: false, unit: "minutes" },
  closedIssueHistory: { amount: 1, unit: "months", unlimited: false },
  linkedPullRequestsCollapsed: true,
  pullRequestHistory: { amount: 1, unit: "months", unlimited: false },
  sidebar: { collapsed: false, width: 460 },
  theme: "system",
  version: 1,
  zoomFactor: 1,
};

export function useDashboardPreferences(enabled: boolean) {
  const [preferences, setPreferences] = useState<DashboardPreferences>(
    DEFAULT_DASHBOARD_PREFERENCES,
  );
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const reloadPreferences = useCallback(async () => {
    if (!enabled) return;
    const loaded = await getDashboardPreferences();
    setPreferences(loaded);
    setIsReady(true);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void reloadPreferences();
  }, [enabled, reloadPreferences]);

  const replacePreferences = useCallback(async (next: DashboardPreferences) => {
    setIsSaving(true);
    try {
      const persisted = await saveDashboardPreferences(next);
      setPreferences(persisted);
      return persisted;
    } finally {
      setIsSaving(false);
    }
  }, []);

  return {
    isReady,
    isSaving,
    preferences,
    reloadPreferences,
    replacePreferences,
  };
}
