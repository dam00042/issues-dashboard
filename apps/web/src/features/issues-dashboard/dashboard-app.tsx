"use client";

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Spinner, toast } from "@heroui/react";
import { useTheme } from "next-themes";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { synchronizeDashboard } from "@/features/issues-dashboard/api";
import {
  ActiveBoard,
  type BoardColumnWidths,
} from "@/features/issues-dashboard/boards/active-board";
import { CompletedBoard } from "@/features/issues-dashboard/boards/completed-board";
import { detectIssueDrop } from "@/features/issues-dashboard/boards/issue-drop-target";
import { PullRequestsBoard } from "@/features/issues-dashboard/boards/pull-requests-board";
import { DashboardFilterBar } from "@/features/issues-dashboard/components/dashboard-filter-bar";
import { DashboardHeader } from "@/features/issues-dashboard/components/dashboard-header";
import { DashboardSettingsModal } from "@/features/issues-dashboard/components/dashboard-settings-modal";
import { DesktopTitleBar } from "@/features/issues-dashboard/components/desktop-title-bar";
import { IssueDragOverlay } from "@/features/issues-dashboard/components/issue-card";
import { DashboardSectionSkeleton } from "@/features/issues-dashboard/components/loading-skeletons";
import { SessionScreen } from "@/features/issues-dashboard/components/session-screen";
import { useDashboardPreferences } from "@/features/issues-dashboard/hooks/use-dashboard-preferences";
import { useDesktopWindow } from "@/features/issues-dashboard/hooks/use-desktop-window";
import { useGitHubActivity } from "@/features/issues-dashboard/hooks/use-github-activity";
import { useIssueSync } from "@/features/issues-dashboard/hooks/use-issue-sync";
import type {
  ClosedWindowOption,
  DashboardIssue,
  DashboardPreferences,
  DashboardSection,
  PriorityValue,
  PullRequestStateFilter,
  PullRequestWindowOption,
  RemoteIssueStateFilter,
  SelectedProjectFields,
} from "@/features/issues-dashboard/types";
import {
  buildProjectFilterDefinitions,
  filterIssuesBySearch,
  issueMatchesProjectFilters,
  issueMatchesRemoteState,
  PRIORITY_DEFINITIONS,
  sortIssuesByPinnedAndUpdated,
} from "@/features/issues-dashboard/utils/dashboard-helpers";
import type { ThemeMode } from "@/types/desktop";

const DEFAULT_CLOSED_WINDOW: ClosedWindowOption = "1m";
const DEFAULT_PULL_REQUEST_WINDOW: PullRequestWindowOption = "1m";
const DEFAULT_AUTO_REFRESH_MINUTES = 0;
const MIN_AUTO_REFRESH_MINUTES = 5;
const MAX_AUTO_REFRESH_MINUTES = 24 * 24 * 60;

const AUTO_REFRESH_UNIT_MINUTES = {
  days: 24 * 60,
  hours: 60,
  minutes: 1,
};

function normalizeAutoRefreshMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.min(
    MAX_AUTO_REFRESH_MINUTES,
    Math.max(MIN_AUTO_REFRESH_MINUTES, Math.floor(minutes)),
  );
}

const HISTORY_UNIT_TO_OPTION = { days: "d", months: "m", years: "y" } as const;

function preferencesToClosedWindow(
  preferences: DashboardPreferences,
): ClosedWindowOption {
  if (preferences.closedIssueHistory.unlimited) return "all";
  const history = preferences.closedIssueHistory;
  return `${String(history.amount)}${HISTORY_UNIT_TO_OPTION[history.unit]}` as ClosedWindowOption;
}

function preferencesToPullRequestWindow(
  preferences: DashboardPreferences,
): PullRequestWindowOption {
  const history = preferences.pullRequestHistory;
  return `${String(history.amount)}${HISTORY_UNIT_TO_OPTION[history.unit]}` as PullRequestWindowOption;
}

function formatRefreshTime(timestamp: string | null): string {
  if (!timestamp) return "Sin actualizar";
  return `Actualizado ${new Intl.DateTimeFormat("es", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp))}`;
}

function markIssueDragActive() {
  document.body.dataset.issueDragActive = "true";
}

function clearIssueDragActive() {
  delete document.body.dataset.issueDragActive;
}

function DashboardStartupScreen({ errorMessage }: { errorMessage: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      {errorMessage ? (
        <div className="max-w-md rounded-2xl border border-[rgb(var(--app-danger))]/35 bg-[rgb(var(--app-danger))]/10 px-4 py-3 text-sm text-[rgb(var(--app-danger))]">
          {errorMessage}
        </div>
      ) : (
        <div className="inline-flex items-center gap-3 rounded-full border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/92 px-4 py-3 text-sm text-[rgb(var(--app-muted))]">
          <Spinner size="sm" />
          Cargando GitHub Dashboard...
        </div>
      )}
    </main>
  );
}

export function DashboardApp() {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const [section, setSection] = useState<DashboardSection>("board");
  const [closedWindow, setClosedWindow] = useState<ClosedWindowOption>(
    DEFAULT_CLOSED_WINDOW,
  );
  const [pullRequestWindow, setPullRequestWindow] =
    useState<PullRequestWindowOption>(DEFAULT_PULL_REQUEST_WINDOW);
  const [autoRefreshMinutes, setAutoRefreshMinutes] = useState(
    DEFAULT_AUTO_REFRESH_MINUTES,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isSynchronizing, setIsSynchronizing] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedState, setSelectedState] =
    useState<RemoteIssueStateFilter>("all");
  const [selectedProjectFields, setSelectedProjectFields] =
    useState<SelectedProjectFields>({});
  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const renderedSection = useDeferredValue(section);
  const [authoredPullRequestFilter, setAuthoredPullRequestFilter] =
    useState<PullRequestStateFilter>("open");
  const [requestedPullRequestFilter, setRequestedPullRequestFilter] =
    useState<PullRequestStateFilter>("open");
  const [boardColumnWidths, setBoardColumnWidths] = useState<BoardColumnWidths>(
    {
      twoColumnLeft: 24,
      threeColumnLeft: 20,
    },
  );
  const isSynchronizingRef = useRef(false);
  const issuePrefetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shownDashboardNoticesRef = useRef({
    project: "",
    pullRequest: "",
    snapshot: "",
    sync: "",
  });
  const initialSynchronizationStartedRef = useRef(false);

  const deferredSearch = useDeferredValue(search);

  const {
    handleClose,
    handleMinimize,
    handleToggleMaximize,
    isDesktopClient,
    isMaximized,
  } = useDesktopWindow((theme as ThemeMode) ?? "system");

  const {
    backendReady,
    backendReadyError,
    completeIssue,
    fetchSnapshotData,
    flushDirtyIssueStates,
    handleClearSession,
    handleSaveSession,
    isEditingSession,
    isFetchingSnapshot,
    isSavingSession,
    issues,
    loadIssueDetail,
    reviewIssue,
    restoreIssue,
    sessionError,
    sessionForm,
    sessionStatus,
    setFormValue,
    setIsEditingSession,
    setPriority,
    snapshot,
    snapshotError,
    syncError,
    togglePin,
    updateNoteBlocks,
  } = useIssueSync(closedWindow);

  const {
    isReady: preferencesReady,
    isSaving: isSavingPreferences,
    preferences,
    reloadPreferences,
    replacePreferences,
  } = useDashboardPreferences(backendReady);

  const persistSidebarPreferences = useCallback(
    (nextSidebar: DashboardPreferences["sidebar"]) => {
      void replacePreferences({
        ...preferences,
        sidebar: nextSidebar,
      }).catch((error) => {
        toast.danger("No se pudo guardar el panel lateral", {
          description:
            error instanceof Error ? error.message : "Inténtalo de nuevo.",
        });
      });
    },
    [preferences, replacePreferences],
  );

  const handleSidebarCollapse = useCallback(
    (collapsed: boolean) => {
      setIsSidebarCollapsed(collapsed);
      persistSidebarPreferences({ ...preferences.sidebar, collapsed });
    },
    [persistSidebarPreferences, preferences.sidebar],
  );

  const handleSidebarWidthChange = useCallback(
    (width: number) => {
      persistSidebarPreferences({ ...preferences.sidebar, width });
    },
    [persistSidebarPreferences, preferences.sidebar],
  );

  const collapseSidebar = useCallback(
    () => handleSidebarCollapse(true),
    [handleSidebarCollapse],
  );
  const expandSidebar = useCallback(
    () => handleSidebarCollapse(false),
    [handleSidebarCollapse],
  );
  const handleColumnWidthChange = useCallback(
    (column: keyof BoardColumnWidths, width: number) => {
      setBoardColumnWidths((current) => ({ ...current, [column]: width }));
    },
    [],
  );

  const {
    hasLoadedPullRequests,
    isFetchingPullRequests,
    pullRequestWarning,
    pullRequests,
    pullRequestsRefreshedAt,
    refreshPullRequests,
  } = useGitHubActivity({
    enabled: Boolean(sessionStatus?.configured) && section === "pull_requests",
    pullRequestWindow,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  useEffect(
    () => () => {
      if (issuePrefetchTimeoutRef.current) {
        clearTimeout(issuePrefetchTimeoutRef.current);
      }
      clearIssueDragActive();
    },
    [],
  );

  useEffect(() => {
    if (!preferencesReady) return;
    const normalized = preferencesToClosedWindow(preferences);
    setClosedWindow(normalized);

    const normalizedPullRequestWindow =
      preferencesToPullRequestWindow(preferences);
    setPullRequestWindow(normalizedPullRequestWindow);

    const normalizedAutoRefreshAmount = preferences.autoRefresh.amount;
    const normalizedAutoRefresh = preferences.autoRefresh.enabled
      ? normalizeAutoRefreshMinutes(
          normalizedAutoRefreshAmount *
            AUTO_REFRESH_UNIT_MINUTES[preferences.autoRefresh.unit],
        )
      : 0;
    setAutoRefreshMinutes(normalizedAutoRefresh);
    setIsSidebarCollapsed(preferences.sidebar.collapsed);
    setTheme(preferences.theme);
    void window.githubIssuesDesktop?.setZoomFactor?.(preferences.zoomFactor);
  }, [preferences, preferencesReady, setTheme]);

  const refreshDashboard = useCallback(async () => {
    if (isSynchronizingRef.current) return;
    isSynchronizingRef.current = true;
    setIsSynchronizing(true);
    try {
      await flushDirtyIssueStates();
      const result = await synchronizeDashboard(
        closedWindow,
        pullRequestWindow,
      );
      await Promise.all([
        fetchSnapshotData(closedWindow, { silent: true }),
        refreshPullRequests(),
      ]);
      if (result.status.warnings.length > 0) {
        toast.warning("Sincronización completada con avisos", {
          description: result.status.warnings.join(" "),
        });
      }
    } catch (error) {
      toast.danger("No se pudo actualizar desde GitHub", {
        description:
          error instanceof Error ? error.message : "Inténtalo de nuevo.",
      });
    } finally {
      isSynchronizingRef.current = false;
      setIsSynchronizing(false);
    }
  }, [
    closedWindow,
    fetchSnapshotData,
    flushDirtyIssueStates,
    pullRequestWindow,
    refreshPullRequests,
  ]);

  useEffect(() => {
    if (
      initialSynchronizationStartedRef.current ||
      !preferencesReady ||
      !sessionStatus?.configured ||
      snapshot === null ||
      issues.length > 0
    ) {
      return;
    }
    initialSynchronizationStartedRef.current = true;
    void refreshDashboard();
  }, [
    issues.length,
    preferencesReady,
    refreshDashboard,
    sessionStatus?.configured,
    snapshot,
  ]);

  useEffect(() => {
    if (autoRefreshMinutes <= 0 || !sessionStatus?.configured) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshDashboard();
    }, autoRefreshMinutes * 60_000);
    return () => window.clearInterval(intervalId);
  }, [autoRefreshMinutes, refreshDashboard, sessionStatus?.configured]);

  const projectFieldFilters = useMemo(
    () => buildProjectFilterDefinitions(issues),
    [issues],
  );

  const filteredIssues = useMemo(() => {
    return filterIssuesBySearch(issues, deferredSearch).filter(
      (issue) =>
        issueMatchesRemoteState(issue, selectedState) &&
        issueMatchesProjectFilters(issue, selectedProjectFields),
    );
  }, [issues, deferredSearch, selectedProjectFields, selectedState]);

  const { backlogIssues, completedIssues, priorityBuckets, reviewIssues } =
    useMemo(() => {
      const backlog: DashboardIssue[] = [];
      const completed: DashboardIssue[] = [];
      const review: DashboardIssue[] = [];
      const priorities = new Map(
        PRIORITY_DEFINITIONS.map((definition) => [
          definition.value,
          [] as DashboardIssue[],
        ]),
      );

      for (const issue of filteredIssues) {
        if (issue.localState.status === "completed") {
          completed.push(issue);
        } else if (issue.localState.status === "in_review") {
          review.push(issue);
        } else if (issue.localState.priority === null) {
          backlog.push(issue);
        } else {
          priorities.get(issue.localState.priority)?.push(issue);
        }
      }

      return {
        backlogIssues: sortIssuesByPinnedAndUpdated(backlog),
        completedIssues: completed,
        priorityBuckets: PRIORITY_DEFINITIONS.map((definition) => ({
          ...definition,
          issues: sortIssuesByPinnedAndUpdated(
            priorities.get(definition.value) ?? [],
          ),
        })),
        reviewIssues: sortIssuesByPinnedAndUpdated(review),
      };
    }, [filteredIssues]);

  const handleSectionChange = useCallback((nextSection: DashboardSection) => {
    clearIssueDragActive();
    setSection(nextSection);
    setSelectedIssueKey(null);
  }, []);

  const activeIssue = useMemo(() => {
    if (!selectedIssueKey) return null;
    const issue =
      issues.find((item) => item.issueKey === selectedIssueKey) ?? null;
    if (!issue) return null;
    if (section === "board" && issue.localState.status !== "active")
      return null;
    if (section === "completed" && issue.localState.status === "active")
      return null;
    return issue;
  }, [issues, selectedIssueKey, section]);

  useEffect(() => {
    if (activeIssue && !activeIssue.detailsLoaded) {
      void loadIssueDetail(activeIssue.issueKey);
    }
  }, [activeIssue, loadIssueDetail]);

  const handleIssueSelect = useCallback(
    (issueKey: string) => {
      if (issuePrefetchTimeoutRef.current) {
        clearTimeout(issuePrefetchTimeoutRef.current);
        issuePrefetchTimeoutRef.current = null;
      }
      setSelectedIssueKey(issueKey);
      setIsSidebarCollapsed(false);
      void loadIssueDetail(issueKey);
    },
    [loadIssueDetail],
  );

  const handleIssuePrefetch = useCallback(
    (issueKey: string) => {
      if (issuePrefetchTimeoutRef.current) {
        clearTimeout(issuePrefetchTimeoutRef.current);
      }
      issuePrefetchTimeoutRef.current = setTimeout(() => {
        issuePrefetchTimeoutRef.current = null;
        if (document.body.dataset.issueDragActive !== "true") {
          void loadIssueDetail(issueKey);
        }
      }, 140);
    },
    [loadIssueDetail],
  );

  const handleDndDragEnd = useCallback(
    (event: DragEndEvent) => {
      clearIssueDragActive();
      const { active, over } = event;

      if (!over) return;

      const issueKey = String(active.id);
      const overId = String(over.id);

      if (overId === "bucket-review") {
        reviewIssue(issueKey);
        return;
      }

      if (overId === "bucket-completed") {
        completeIssue(issueKey);
        return;
      }

      if (overId.startsWith("bucket-")) {
        const priorityRaw = overId.replace("bucket-", "");
        const nextPriority: PriorityValue | null =
          priorityRaw === "null"
            ? null
            : (Number.parseInt(priorityRaw, 10) as PriorityValue);

        const targetIssue = issues.find((i) => i.issueKey === issueKey);
        if (targetIssue && targetIssue.localState.status !== "active") {
          restoreIssue(issueKey);
        }
        setPriority(issueKey, nextPriority);
      }
    },
    [completeIssue, issues, restoreIssue, reviewIssue, setPriority],
  );

  const snapshotConnectivityNotice =
    snapshotError && issues.length > 0
      ? "Sin conexión de red. Mostrando datos locales guardados; puedes seguir trabajando en local."
      : "";
  const projectFieldsNotice = snapshot?.meta.projectFieldsWarning ?? "";

  useEffect(() => {
    const shownNotices = shownDashboardNoticesRef.current;

    if (syncError && syncError !== shownNotices.sync) {
      toast.danger("No se pudieron guardar los cambios", {
        description: syncError,
      });
    }
    shownNotices.sync = syncError;

    if (
      snapshotConnectivityNotice &&
      snapshotConnectivityNotice !== shownNotices.snapshot
    ) {
      toast.warning("Trabajando con los datos locales", {
        description: snapshotConnectivityNotice,
      });
    }
    shownNotices.snapshot = snapshotConnectivityNotice;

    if (projectFieldsNotice && projectFieldsNotice !== shownNotices.project) {
      toast.warning("No se pudieron cargar los campos de Projects", {
        description: projectFieldsNotice,
      });
    }
    shownNotices.project = projectFieldsNotice;

    if (pullRequestWarning && pullRequestWarning !== shownNotices.pullRequest) {
      toast.warning("No se pudieron actualizar las Pull Requests", {
        description: pullRequestWarning,
      });
    }
    shownNotices.pullRequest = pullRequestWarning;
  }, [
    projectFieldsNotice,
    pullRequestWarning,
    snapshotConnectivityNotice,
    syncError,
  ]);

  const handleExportBackup = useCallback(async () => {
    const exportBackup = window.githubIssuesDesktop?.exportBackup;
    if (!exportBackup) return;

    try {
      await flushDirtyIssueStates();
      const result = await exportBackup();
      if (result.cancelled) return;

      toast.success("Copia de seguridad exportada", {
        description: result.path
          ? `Guardada en ${result.path}.`
          : "Los datos y ajustes se han exportado correctamente.",
      });
    } catch (error) {
      toast.danger("No se pudo exportar la copia de seguridad", {
        description:
          error instanceof Error
            ? error.message
            : "Inténtalo de nuevo dentro de unos segundos.",
      });
    }
  }, [flushDirtyIssueStates]);

  const handleImportBackup = useCallback(async () => {
    const importBackup = window.githubIssuesDesktop?.importBackup;
    if (!importBackup) return;

    try {
      await flushDirtyIssueStates();
      const result = await importBackup();
      if (result.cancelled) return;

      await Promise.all([
        fetchSnapshotData(closedWindow, { replaceLocalState: true }),
        refreshPullRequests(),
        reloadPreferences(),
      ]);
      toast.success("Copia de seguridad importada", {
        description: result.path
          ? `Datos restaurados desde ${result.path}.`
          : "Los datos y ajustes se han restaurado correctamente.",
      });
    } catch (error) {
      toast.danger("No se pudo importar la copia de seguridad", {
        description:
          error instanceof Error
            ? error.message
            : "Comprueba el archivo e inténtalo de nuevo.",
      });
    }
  }, [
    closedWindow,
    fetchSnapshotData,
    flushDirtyIssueStates,
    refreshPullRequests,
    reloadPreferences,
  ]);

  const cycleTheme = useCallback(() => {
    const nextTheme = resolvedTheme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    void replacePreferences({ ...preferences, theme: nextTheme });
  }, [preferences, replacePreferences, resolvedTheme, setTheme]);

  const handleClearFilters = useCallback(() => {
    setSearch("");
    setSelectedState("all");
    setSelectedProjectFields({});
  }, []);

  const handleProjectFieldChange = useCallback(
    (fieldKey: string, value: string) => {
      setSelectedProjectFields((currentFields) => {
        if (value === "all") {
          const nextFields = { ...currentFields };
          delete nextFields[fieldKey];
          return nextFields;
        }
        return { ...currentFields, [fieldKey]: value };
      });
    },
    [],
  );

  if (!backendReady) {
    return <DashboardStartupScreen errorMessage={backendReadyError} />;
  }

  if (!sessionStatus?.configured || isEditingSession) {
    return (
      <SessionScreen
        errorMessage={sessionError}
        form={sessionForm}
        isEditing={isEditingSession}
        isSaving={isSavingSession}
        topInset={isDesktopClient}
        onCancel={() => setIsEditingSession(false)}
        onChange={setFormValue}
        onSave={() => void handleSaveSession()}
      />
    );
  }

  const hasActiveFilters = Boolean(
    search.trim() ||
      selectedState !== "all" ||
      Object.values(selectedProjectFields).some(
        (value) => value && value !== "all",
      ),
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[rgb(var(--app-bg))] font-sans antialiased">
      {isDesktopClient ? (
        <div className="shrink-0 p-2 pb-0">
          <DesktopTitleBar
            isMaximized={isMaximized}
            onClose={handleClose}
            onMinimize={handleMinimize}
            onToggleMaximize={handleToggleMaximize}
          />
        </div>
      ) : null}

      <main className="min-h-0 flex-1 overflow-hidden p-4 pt-3">
        <div className="flex h-full flex-col gap-2">
          <DashboardHeader
            isDesktopClient={isDesktopClient}
            isFetching={
              isSynchronizing || isFetchingPullRequests || isFetchingSnapshot
            }
            lastRefreshLabel={formatRefreshTime(
              section === "pull_requests"
                ? pullRequestsRefreshedAt
                : (snapshot?.meta.refreshedAt ?? null),
            )}
            section={section}
            username={sessionStatus.username}
            onClearSession={() => void handleClearSession()}
            onCycleTheme={cycleTheme}
            onEditSession={() => setIsEditingSession(true)}
            onExportBackup={() => void handleExportBackup()}
            onImportBackup={() => void handleImportBackup()}
            onOpenSettings={() => setSettingsOpen(true)}
            onRefresh={() => void refreshDashboard()}
            onSectionChange={handleSectionChange}
          />

          {section !== "pull_requests" ? (
            <DashboardFilterBar
              hasActiveFilters={hasActiveFilters}
              projectFieldFilters={projectFieldFilters}
              search={search}
              selectedProjectFields={selectedProjectFields}
              selectedState={selectedState}
              onClearFilters={handleClearFilters}
              onProjectFieldChange={handleProjectFieldChange}
              onSearchChange={setSearch}
              onStateChange={setSelectedState}
            />
          ) : null}

          <div className="min-h-0 flex-1">
            {renderedSection !== section ||
            (section !== "pull_requests" && snapshot === null) ||
            (section === "pull_requests" && !hasLoadedPullRequests) ? (
              <DashboardSectionSkeleton />
            ) : renderedSection === "pull_requests" ? (
              <PullRequestsBoard
                authoredFilter={authoredPullRequestFilter}
                pullRequests={pullRequests}
                requestedFilter={requestedPullRequestFilter}
                onAuthoredFilterChange={setAuthoredPullRequestFilter}
                onRequestedFilterChange={setRequestedPullRequestFilter}
              />
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={detectIssueDrop}
                onDragStart={markIssueDragActive}
                onDragCancel={clearIssueDragActive}
                onDragEnd={handleDndDragEnd}
              >
                {renderedSection === "board" ? (
                  <ActiveBoard
                    activeIssue={activeIssue}
                    backlogIssues={backlogIssues}
                    columnWidths={boardColumnWidths}
                    isSidebarCollapsed={isSidebarCollapsed}
                    linkedPullRequestsCollapsed={
                      preferences.linkedPullRequestsCollapsed
                    }
                    priorityBuckets={priorityBuckets}
                    selectedIssueKey={selectedIssueKey}
                    sidebarWidth={preferences.sidebar.width}
                    onCollapseSidebar={collapseSidebar}
                    onColumnWidthChange={handleColumnWidthChange}
                    onExpandSidebar={expandSidebar}
                    onCompleteIssue={completeIssue}
                    onReviewIssue={reviewIssue}
                    onIssuePrefetch={handleIssuePrefetch}
                    onIssueSelect={handleIssueSelect}
                    onSidebarWidthChange={handleSidebarWidthChange}
                    onSetPriority={setPriority}
                    onTogglePin={togglePin}
                    onUpdateBlocks={updateNoteBlocks}
                  />
                ) : (
                  <CompletedBoard
                    activeIssue={activeIssue}
                    completedIssues={completedIssues}
                    isSidebarCollapsed={isSidebarCollapsed}
                    linkedPullRequestsCollapsed={
                      preferences.linkedPullRequestsCollapsed
                    }
                    reviewIssues={reviewIssues}
                    selectedIssueKey={selectedIssueKey}
                    sidebarWidth={preferences.sidebar.width}
                    onCollapseSidebar={collapseSidebar}
                    onExpandSidebar={expandSidebar}
                    onIssuePrefetch={handleIssuePrefetch}
                    onIssueSelect={handleIssueSelect}
                    onSidebarWidthChange={handleSidebarWidthChange}
                    onRestoreIssue={restoreIssue}
                    onSetPriority={setPriority}
                    onReviewIssue={reviewIssue}
                    onCompleteIssue={completeIssue}
                    onUpdateBlocks={updateNoteBlocks}
                  />
                )}
                <IssueDragOverlay />
              </DndContext>
            )}
          </div>
        </div>
      </main>

      {settingsOpen ? (
        <DashboardSettingsModal
          isOpen
          isSaving={isSavingPreferences}
          preferences={preferences}
          onOpenChange={setSettingsOpen}
          onSave={async (nextPreferences) => {
            try {
              await replacePreferences(nextPreferences);
              setSettingsOpen(false);
            } catch (error) {
              toast.danger("No se pudieron guardar los ajustes", {
                description:
                  error instanceof Error
                    ? error.message
                    : "Inténtalo de nuevo.",
              });
            }
          }}
        />
      ) : null}
    </div>
  );
}
