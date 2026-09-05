"use client";

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  Button,
  Input,
  ListBox,
  Modal,
  Select,
  Spinner,
  Switch,
  toast,
} from "@heroui/react";
import { useTheme } from "next-themes";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ActiveBoard } from "@/features/issues-dashboard/boards/active-board";
import { CompletedBoard } from "@/features/issues-dashboard/boards/completed-board";
import { PullRequestsBoard } from "@/features/issues-dashboard/boards/pull-requests-board";
import { DashboardFilterBar } from "@/features/issues-dashboard/components/dashboard-filter-bar";
import { DashboardHeader } from "@/features/issues-dashboard/components/dashboard-header";
import { DesktopTitleBar } from "@/features/issues-dashboard/components/desktop-title-bar";
import { IssueDragOverlay } from "@/features/issues-dashboard/components/issue-card";
import { SessionScreen } from "@/features/issues-dashboard/components/session-screen";
import { useDesktopWindow } from "@/features/issues-dashboard/hooks/use-desktop-window";
import { useGitHubActivity } from "@/features/issues-dashboard/hooks/use-github-activity";
import { useIssueSync } from "@/features/issues-dashboard/hooks/use-issue-sync";
import type {
  ClosedWindowOption,
  ClosedWindowUnit,
  DashboardSection,
  PriorityValue,
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

const STORAGE_KEYS = {
  autoRefreshAmount: "issues-dashboard:auto-refresh-amount",
  autoRefreshMinutes: "issues-dashboard:auto-refresh-minutes",
  autoRefreshUnit: "issues-dashboard:auto-refresh-unit",
  closedWindow: "issues-dashboard:closed-window",
  pullRequestWindow: "issues-dashboard:pull-request-window",
};
const DEFAULT_CLOSED_WINDOW: ClosedWindowOption = "1m";
const DEFAULT_PULL_REQUEST_WINDOW: PullRequestWindowOption = "1m";
const DEFAULT_AUTO_REFRESH_MINUTES = 0;
const DEFAULT_AUTO_REFRESH_AMOUNT = 5;
const MIN_AUTO_REFRESH_MINUTES = 5;
const MAX_AUTO_REFRESH_MINUTES = 24 * 24 * 60;

type AutoRefreshUnit = "m" | "h" | "d";

const AUTO_REFRESH_UNIT_MINUTES: Record<AutoRefreshUnit, number> = {
  d: 24 * 60,
  h: 60,
  m: 1,
};

function readStoredPreference<T>(storageKey: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const rawValue = window.localStorage.getItem(storageKey);
  if (!rawValue) return fallback;
  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
}

function writeStoredPreference<T>(storageKey: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(value));
}

function normalizeClosedWindowOption(
  rawValue: string,
  fallback: ClosedWindowOption = DEFAULT_CLOSED_WINDOW,
): ClosedWindowOption {
  const normalizedValue = rawValue.trim().toLowerCase();
  if (normalizedValue === "all") return "all";
  const match = /^(\d+)([dmy])?$/.exec(normalizedValue);
  if (!match) return fallback;
  const amount = Number.parseInt(match[1] ?? "", 10);
  if (Number.isNaN(amount) || amount <= 0) return fallback;
  return `${String(amount)}${match[2] ?? "m"}` as ClosedWindowOption;
}

function splitClosedWindowOption(closedWindow: ClosedWindowOption): {
  amount: string;
  unit: ClosedWindowUnit;
} {
  if (closedWindow === "all") return { amount: "1", unit: "m" };
  return {
    amount: closedWindow.slice(0, -1),
    unit: closedWindow.at(-1) as ClosedWindowUnit,
  };
}

function normalizePullRequestWindowOption(
  rawValue: string,
): PullRequestWindowOption {
  const normalized = normalizeClosedWindowOption(
    rawValue,
    DEFAULT_PULL_REQUEST_WINDOW,
  );
  return normalized === "all" ? DEFAULT_PULL_REQUEST_WINDOW : normalized;
}

function splitAutoRefreshMinutes(minutes: number): {
  amount: number;
  unit: AutoRefreshUnit;
} {
  if (minutes <= 0) {
    return { amount: DEFAULT_AUTO_REFRESH_AMOUNT, unit: "m" };
  }
  if (minutes % AUTO_REFRESH_UNIT_MINUTES.d === 0) {
    return { amount: minutes / AUTO_REFRESH_UNIT_MINUTES.d, unit: "d" };
  }
  if (minutes % AUTO_REFRESH_UNIT_MINUTES.h === 0) {
    return { amount: minutes / AUTO_REFRESH_UNIT_MINUTES.h, unit: "h" };
  }
  return { amount: minutes, unit: "m" };
}

function isAutoRefreshUnit(value: string): value is AutoRefreshUnit {
  return value === "m" || value === "h" || value === "d";
}

function normalizeAutoRefreshMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.min(
    MAX_AUTO_REFRESH_MINUTES,
    Math.max(MIN_AUTO_REFRESH_MINUTES, Math.floor(minutes)),
  );
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
  const [closedWindowDraftAmount, setClosedWindowDraftAmount] = useState("1");
  const [closedWindowDraftUnit, setClosedWindowDraftUnit] =
    useState<ClosedWindowUnit>("m");
  const [closedWindowUnlimitedDraft, setClosedWindowUnlimitedDraft] =
    useState(false);
  const [closedWindowDraftError, setClosedWindowDraftError] = useState("");
  const [pullRequestWindow, setPullRequestWindow] =
    useState<PullRequestWindowOption>(DEFAULT_PULL_REQUEST_WINDOW);
  const [pullRequestWindowDraftAmount, setPullRequestWindowDraftAmount] =
    useState("1");
  const [pullRequestWindowDraftUnit, setPullRequestWindowDraftUnit] =
    useState<ClosedWindowUnit>("m");
  const [pullRequestWindowDraftError, setPullRequestWindowDraftError] =
    useState("");
  const [autoRefreshMinutes, setAutoRefreshMinutes] = useState(
    DEFAULT_AUTO_REFRESH_MINUTES,
  );
  const [autoRefreshAmount, setAutoRefreshAmount] = useState(
    DEFAULT_AUTO_REFRESH_AMOUNT,
  );
  const [autoRefreshUnit, setAutoRefreshUnit] = useState<AutoRefreshUnit>("m");
  const [autoRefreshEnabledDraft, setAutoRefreshEnabledDraft] = useState(false);
  const [autoRefreshDraftAmount, setAutoRefreshDraftAmount] = useState(
    String(DEFAULT_AUTO_REFRESH_AMOUNT),
  );
  const [autoRefreshDraftUnit, setAutoRefreshDraftUnit] =
    useState<AutoRefreshUnit>("m");
  const [autoRefreshDraftError, setAutoRefreshDraftError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedState, setSelectedState] =
    useState<RemoteIssueStateFilter>("all");
  const [selectedProjectFields, setSelectedProjectFields] =
    useState<SelectedProjectFields>({});
  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const shownDashboardNoticesRef = useRef({
    project: "",
    snapshot: "",
    sync: "",
  });

  const deferredSearch = useDeferredValue(search);

  function applyClosedWindow(closedWindowValue: ClosedWindowOption) {
    const windowChanged = closedWindowValue !== closedWindow;
    setClosedWindow(closedWindowValue);
    setClosedWindowUnlimitedDraft(closedWindowValue === "all");
    if (closedWindowValue !== "all") {
      const parts = splitClosedWindowOption(closedWindowValue);
      setClosedWindowDraftAmount(parts.amount);
      setClosedWindowDraftUnit(parts.unit);
    }
    setClosedWindowDraftError("");
    writeStoredPreference(STORAGE_KEYS.closedWindow, closedWindowValue);
    if (windowChanged) void fetchSnapshotData(closedWindowValue);
  }

  function applySettingsDraft() {
    let nextClosedWindow: ClosedWindowOption = "all";
    if (!closedWindowUnlimitedDraft) {
      const parsedClosedAmount = Number.parseInt(
        closedWindowDraftAmount.trim(),
        10,
      );
      if (Number.isNaN(parsedClosedAmount) || parsedClosedAmount <= 0) {
        setClosedWindowDraftError("Indica un número entero positivo.");
        return;
      }
      nextClosedWindow =
        `${String(parsedClosedAmount)}${closedWindowDraftUnit}` as ClosedWindowOption;
    }

    const parsedPullRequestAmount = Number.parseInt(
      pullRequestWindowDraftAmount.trim(),
      10,
    );
    if (Number.isNaN(parsedPullRequestAmount) || parsedPullRequestAmount <= 0) {
      setPullRequestWindowDraftError("Indica un número entero positivo.");
      return;
    }
    const nextPullRequestWindow =
      `${String(parsedPullRequestAmount)}${pullRequestWindowDraftUnit}` as PullRequestWindowOption;

    const normalizedAutoRefreshAmount = autoRefreshDraftAmount.trim();
    const parsedAutoRefreshAmount = /^\d+$/.test(normalizedAutoRefreshAmount)
      ? Number.parseInt(normalizedAutoRefreshAmount, 10)
      : Number.NaN;
    const nextAutoRefreshAmount =
      Number.isNaN(parsedAutoRefreshAmount) || parsedAutoRefreshAmount <= 0
        ? autoRefreshAmount
        : parsedAutoRefreshAmount;
    const nextAutoRefreshMinutes =
      nextAutoRefreshAmount * AUTO_REFRESH_UNIT_MINUTES[autoRefreshDraftUnit];

    if (
      autoRefreshEnabledDraft &&
      (Number.isNaN(parsedAutoRefreshAmount) || parsedAutoRefreshAmount <= 0)
    ) {
      setAutoRefreshDraftError("Indica un número entero positivo.");
      return;
    }
    if (
      autoRefreshEnabledDraft &&
      (nextAutoRefreshMinutes < MIN_AUTO_REFRESH_MINUTES ||
        nextAutoRefreshMinutes > MAX_AUTO_REFRESH_MINUTES)
    ) {
      setAutoRefreshDraftError(
        "La frecuencia debe estar entre 5 minutos y 24 días.",
      );
      return;
    }

    applyClosedWindow(nextClosedWindow);
    setPullRequestWindow(nextPullRequestWindow);
    setPullRequestWindowDraftError("");
    writeStoredPreference(
      STORAGE_KEYS.pullRequestWindow,
      nextPullRequestWindow,
    );
    setAutoRefreshAmount(nextAutoRefreshAmount);
    setAutoRefreshUnit(autoRefreshDraftUnit);
    setAutoRefreshMinutes(autoRefreshEnabledDraft ? nextAutoRefreshMinutes : 0);
    writeStoredPreference(
      STORAGE_KEYS.autoRefreshMinutes,
      autoRefreshEnabledDraft ? nextAutoRefreshMinutes : 0,
    );
    writeStoredPreference(
      STORAGE_KEYS.autoRefreshAmount,
      nextAutoRefreshAmount,
    );
    writeStoredPreference(STORAGE_KEYS.autoRefreshUnit, autoRefreshDraftUnit);
    setSettingsOpen(false);
  }

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
    handleClearSession,
    handleSaveSession,
    isEditingSession,
    isFetchingSnapshot,
    isSavingSession,
    issues,
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
    isFetchingPullRequests,
    pullRequestWarning,
    pullRequests,
    pullRequestsRefreshedAt,
    refreshPullRequests,
  } = useGitHubActivity({
    enabled: Boolean(sessionStatus?.configured),
    pullRequestWindow,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => {
    const storedOption = readStoredPreference<string>(
      STORAGE_KEYS.closedWindow,
      DEFAULT_CLOSED_WINDOW,
    );
    const normalized = normalizeClosedWindowOption(storedOption);
    setClosedWindow(normalized);
    setClosedWindowUnlimitedDraft(normalized === "all");
    if (normalized !== "all") {
      const parts = splitClosedWindowOption(normalized);
      setClosedWindowDraftAmount(parts.amount);
      setClosedWindowDraftUnit(parts.unit);
    }

    const storedPullRequestWindow = readStoredPreference<string>(
      STORAGE_KEYS.pullRequestWindow,
      DEFAULT_PULL_REQUEST_WINDOW,
    );
    const normalizedPullRequestWindow = normalizePullRequestWindowOption(
      storedPullRequestWindow,
    );
    const pullRequestWindowParts = splitClosedWindowOption(
      normalizedPullRequestWindow,
    );
    setPullRequestWindow(normalizedPullRequestWindow);
    setPullRequestWindowDraftAmount(pullRequestWindowParts.amount);
    setPullRequestWindowDraftUnit(pullRequestWindowParts.unit);

    const storedAutoRefresh = readStoredPreference<number>(
      STORAGE_KEYS.autoRefreshMinutes,
      DEFAULT_AUTO_REFRESH_MINUTES,
    );
    const normalizedAutoRefresh =
      normalizeAutoRefreshMinutes(storedAutoRefresh);
    const fallbackAutoRefreshParts = splitAutoRefreshMinutes(
      normalizedAutoRefresh,
    );
    const storedAutoRefreshAmount = readStoredPreference<number>(
      STORAGE_KEYS.autoRefreshAmount,
      fallbackAutoRefreshParts.amount,
    );
    const storedAutoRefreshUnit = readStoredPreference<string>(
      STORAGE_KEYS.autoRefreshUnit,
      fallbackAutoRefreshParts.unit,
    );
    const normalizedAutoRefreshAmount =
      Number.isInteger(storedAutoRefreshAmount) && storedAutoRefreshAmount > 0
        ? storedAutoRefreshAmount
        : fallbackAutoRefreshParts.amount;
    const normalizedAutoRefreshUnit = isAutoRefreshUnit(storedAutoRefreshUnit)
      ? storedAutoRefreshUnit
      : fallbackAutoRefreshParts.unit;
    setAutoRefreshMinutes(normalizedAutoRefresh);
    setAutoRefreshAmount(normalizedAutoRefreshAmount);
    setAutoRefreshUnit(normalizedAutoRefreshUnit);
    setAutoRefreshEnabledDraft(normalizedAutoRefresh > 0);
    setAutoRefreshDraftAmount(String(normalizedAutoRefreshAmount));
    setAutoRefreshDraftUnit(normalizedAutoRefreshUnit);
  }, []);

  useEffect(() => {
    if (section === "pull_requests") {
      void refreshPullRequests();
    }
  }, [refreshPullRequests, section]);

  const refreshCurrentSection = useCallback(() => {
    if (section === "pull_requests") {
      return refreshPullRequests();
    }
    return fetchSnapshotData(closedWindow);
  }, [closedWindow, fetchSnapshotData, refreshPullRequests, section]);

  useEffect(() => {
    if (autoRefreshMinutes <= 0 || !sessionStatus?.configured) return;
    const intervalId = window.setInterval(
      () => void refreshCurrentSection(),
      autoRefreshMinutes * 60_000,
    );
    return () => window.clearInterval(intervalId);
  }, [autoRefreshMinutes, refreshCurrentSection, sessionStatus?.configured]);

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

  const activeIssues = useMemo(
    () =>
      filteredIssues.filter((issue) => issue.localState.status === "active"),
    [filteredIssues],
  );

  const reviewIssues = useMemo(
    () =>
      sortIssuesByPinnedAndUpdated(
        filteredIssues.filter(
          (issue) => issue.localState.status === "in_review",
        ),
      ),
    [filteredIssues],
  );

  const completedIssues = useMemo(
    () =>
      filteredIssues.filter((issue) => issue.localState.status === "completed"),
    [filteredIssues],
  );

  const backlogIssues = useMemo(
    () =>
      sortIssuesByPinnedAndUpdated(
        activeIssues.filter((issue) => issue.localState.priority === null),
      ),
    [activeIssues],
  );

  const priorityBuckets = useMemo(
    () =>
      PRIORITY_DEFINITIONS.map((definition) => ({
        ...definition,
        issues: sortIssuesByPinnedAndUpdated(
          activeIssues.filter(
            (issue) => issue.localState.priority === definition.value,
          ),
        ),
      })),
    [activeIssues],
  );

  const handleSectionChange = (nextSection: DashboardSection) => {
    setSection(nextSection);
    setSelectedIssueKey(null);
  };

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

  const handleIssueSelect = useCallback((issueKey: string) => {
    setSelectedIssueKey(issueKey);
    setIsSidebarCollapsed(false);
  }, []);

  const handleDndDragEnd = (event: DragEndEvent) => {
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
  };

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
  }, [projectFieldsNotice, snapshotConnectivityNotice, syncError]);

  const handleExportDatabase = useCallback(async () => {
    const exportDatabase = window.githubIssuesDesktop?.exportDatabase;
    if (!exportDatabase) return;

    try {
      const result = await exportDatabase();
      if (result.cancelled) return;

      toast.success("Copia de seguridad exportada", {
        description: result.path
          ? `Guardada en ${result.path}.`
          : "La base de datos se ha exportado correctamente.",
      });
    } catch (error) {
      toast.danger("No se pudo exportar la copia de seguridad", {
        description:
          error instanceof Error
            ? error.message
            : "Inténtalo de nuevo dentro de unos segundos.",
      });
    }
  }, []);

  const handleImportDatabase = useCallback(async () => {
    const importDatabase = window.githubIssuesDesktop?.importDatabase;
    if (!importDatabase) return;

    try {
      const result = await importDatabase();
      if (result.cancelled) return;

      await fetchSnapshotData(closedWindow);
      toast.success("Copia de seguridad importada", {
        description: result.path
          ? `Datos restaurados desde ${result.path}.`
          : "La base de datos se ha importado correctamente.",
      });
    } catch (error) {
      toast.danger("No se pudo importar la copia de seguridad", {
        description:
          error instanceof Error
            ? error.message
            : "Comprueba el archivo e inténtalo de nuevo.",
      });
    }
  }, [closedWindow, fetchSnapshotData]);

  function cycleTheme() {
    if (resolvedTheme === "dark") setTheme("light");
    else setTheme("dark");
  }

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

  const handleClearFilters = () => {
    setSearch("");
    setSelectedState("all");
    setSelectedProjectFields({});
  };

  const handleProjectFieldChange = (fieldKey: string, value: string) => {
    setSelectedProjectFields((currentFields) => {
      if (value === "all") {
        const nextFields = { ...currentFields };
        delete nextFields[fieldKey];
        return nextFields;
      }
      return { ...currentFields, [fieldKey]: value };
    });
  };

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
              section === "pull_requests"
                ? isFetchingPullRequests
                : isFetchingSnapshot
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
            onExportDatabase={() => void handleExportDatabase()}
            onImportDatabase={() => void handleImportDatabase()}
            onOpenSettings={() => {
              setClosedWindowUnlimitedDraft(closedWindow === "all");
              if (closedWindow !== "all") {
                const parts = splitClosedWindowOption(closedWindow);
                setClosedWindowDraftAmount(parts.amount);
                setClosedWindowDraftUnit(parts.unit);
              }
              const pullRequestWindowParts =
                splitClosedWindowOption(pullRequestWindow);
              setPullRequestWindowDraftAmount(pullRequestWindowParts.amount);
              setPullRequestWindowDraftUnit(pullRequestWindowParts.unit);
              setPullRequestWindowDraftError("");
              setAutoRefreshEnabledDraft(autoRefreshMinutes > 0);
              setAutoRefreshDraftAmount(String(autoRefreshAmount));
              setAutoRefreshDraftUnit(autoRefreshUnit);
              setAutoRefreshDraftError("");
              setClosedWindowDraftError("");
              setSettingsOpen(true);
            }}
            onRefresh={() => void refreshCurrentSection()}
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
            {section === "board" ? (
              <DndContext
                sensors={sensors}
                collisionDetection={pointerWithin}
                onDragStart={markIssueDragActive}
                onDragCancel={clearIssueDragActive}
                onDragEnd={handleDndDragEnd}
              >
                <ActiveBoard
                  activeIssue={activeIssue}
                  backlogIssues={backlogIssues}
                  isSidebarCollapsed={isSidebarCollapsed}
                  priorityBuckets={priorityBuckets}
                  selectedIssueKey={selectedIssueKey}
                  onCollapseSidebar={() => setIsSidebarCollapsed(true)}
                  onExpandSidebar={() => setIsSidebarCollapsed(false)}
                  onCompleteIssue={completeIssue}
                  onReviewIssue={reviewIssue}
                  onIssueSelect={handleIssueSelect}
                  onSetPriority={setPriority}
                  onTogglePin={togglePin}
                  onUpdateBlocks={updateNoteBlocks}
                />
                <IssueDragOverlay />
              </DndContext>
            ) : section === "completed" ? (
              <DndContext
                sensors={sensors}
                collisionDetection={pointerWithin}
                onDragStart={markIssueDragActive}
                onDragCancel={clearIssueDragActive}
                onDragEnd={handleDndDragEnd}
              >
                <CompletedBoard
                  activeIssue={activeIssue}
                  completedIssues={completedIssues}
                  isSidebarCollapsed={isSidebarCollapsed}
                  reviewIssues={reviewIssues}
                  selectedIssueKey={selectedIssueKey}
                  onCollapseSidebar={() => setIsSidebarCollapsed(true)}
                  onExpandSidebar={() => setIsSidebarCollapsed(false)}
                  onIssueSelect={handleIssueSelect}
                  onRestoreIssue={restoreIssue}
                  onSetPriority={setPriority}
                  onReviewIssue={reviewIssue}
                  onCompleteIssue={completeIssue}
                  onUpdateBlocks={updateNoteBlocks}
                />
                <IssueDragOverlay />
              </DndContext>
            ) : (
              <PullRequestsBoard
                pullRequests={pullRequests}
                warning={pullRequestWarning}
              />
            )}
          </div>
        </div>
      </main>

      <Modal>
        <Modal.Backdrop
          isDismissable
          isOpen={settingsOpen}
          variant="blur"
          onOpenChange={setSettingsOpen}
        >
          <Modal.Container size="lg">
            <Modal.Dialog className="w-[calc(100vw-2rem)] !max-w-[52rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))] text-[rgb(var(--app-foreground))]">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Ajustes</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <div className="space-y-6 px-1">
                  <section className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-[rgb(var(--app-foreground))]">
                        Historial de issues cerradas
                      </p>
                      <p
                        className="mt-1 text-xs text-[rgb(var(--app-muted))]"
                        title="Las issues abiertas siempre se muestran. Este límite solo afecta a las cerradas."
                      >
                        Define cuánto historial cerrado quieres cargar.
                      </p>
                    </div>
                    <div
                      className={`grid grid-cols-[minmax(0,1fr)_minmax(9rem,0.8fr)] gap-2 transition-opacity ${
                        closedWindowUnlimitedDraft ? "opacity-50" : ""
                      }`}
                    >
                      <Input
                        aria-label="Cantidad de historial cerrado"
                        disabled={closedWindowUnlimitedDraft}
                        min="1"
                        placeholder="1"
                        type="number"
                        value={closedWindowDraftAmount}
                        onChange={(event) => {
                          setClosedWindowDraftAmount(event.target.value);
                          setClosedWindowDraftError("");
                        }}
                      />
                      <Select
                        aria-label="Unidad del historial cerrado"
                        isDisabled={closedWindowUnlimitedDraft}
                        value={closedWindowDraftUnit}
                        onChange={(value) =>
                          value !== null &&
                          setClosedWindowDraftUnit(value as ClosedWindowUnit)
                        }
                      >
                        <Select.Trigger className="h-10 w-full">
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="d" textValue="Días">
                              Días
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                            <ListBox.Item id="m" textValue="Meses">
                              Meses
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                            <ListBox.Item id="y" textValue="Años">
                              Años
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                    <Switch
                      isSelected={closedWindowUnlimitedDraft}
                      className="w-full justify-between gap-4 rounded-2xl border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/70 px-4 py-3"
                      onChange={(isSelected) => {
                        setClosedWindowUnlimitedDraft(isSelected);
                        setClosedWindowDraftError("");
                      }}
                    >
                      <Switch.Content className="min-w-0 text-left">
                        <span className="block text-sm font-medium text-[rgb(var(--app-foreground))]">
                          Sin límite de antigüedad
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-[rgb(var(--app-muted))]">
                          Carga todas las issues cerradas disponibles.
                        </span>
                      </Switch.Content>
                      <Switch.Control className="shrink-0">
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch>
                    {closedWindowDraftError ? (
                      <p className="text-xs font-medium text-[rgb(var(--app-danger))]">
                        {closedWindowDraftError}
                      </p>
                    ) : null}
                  </section>

                  <section className="space-y-3 border-t border-[rgb(var(--app-border))]/70 pt-5">
                    <div>
                      <p className="text-sm font-semibold text-[rgb(var(--app-foreground))]">
                        Historial de Pull Requests
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[rgb(var(--app-muted))]">
                        Carga solo PRs con actividad en el periodo elegido (1
                        mes por defecto).
                      </p>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(9rem,0.8fr)] gap-2">
                      <Input
                        aria-label="Cantidad de historial de Pull Requests"
                        min="1"
                        placeholder="1"
                        step="1"
                        type="number"
                        value={pullRequestWindowDraftAmount}
                        onChange={(event) => {
                          setPullRequestWindowDraftAmount(event.target.value);
                          setPullRequestWindowDraftError("");
                        }}
                      />
                      <Select
                        aria-label="Unidad del historial de Pull Requests"
                        value={pullRequestWindowDraftUnit}
                        onChange={(value) => {
                          if (value === null) return;
                          setPullRequestWindowDraftUnit(
                            value as ClosedWindowUnit,
                          );
                          setPullRequestWindowDraftError("");
                        }}
                      >
                        <Select.Trigger className="h-10 w-full">
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="d" textValue="Días">
                              Días
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                            <ListBox.Item id="m" textValue="Meses">
                              Meses
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                            <ListBox.Item id="y" textValue="Años">
                              Años
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                    {pullRequestWindowDraftError ? (
                      <p className="text-xs font-medium text-[rgb(var(--app-danger))]">
                        {pullRequestWindowDraftError}
                      </p>
                    ) : null}
                  </section>

                  <section className="space-y-3 border-t border-[rgb(var(--app-border))]/70 pt-5">
                    <div>
                      <p className="text-sm font-semibold text-[rgb(var(--app-foreground))]">
                        Actualización automática
                      </p>
                      <p className="mt-1 text-xs text-[rgb(var(--app-muted))]">
                        Refresca la sección visible mientras la app esté
                        abierta.
                      </p>
                    </div>
                    <Switch
                      isSelected={autoRefreshEnabledDraft}
                      className="w-full justify-between gap-4 rounded-2xl border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/70 px-4 py-3"
                      onChange={(isSelected) => {
                        setAutoRefreshEnabledDraft(isSelected);
                        setAutoRefreshDraftError("");
                      }}
                    >
                      <Switch.Content className="min-w-0 text-left">
                        <span className="block text-sm font-medium text-[rgb(var(--app-foreground))]">
                          Activar refresco periódico
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-[rgb(var(--app-muted))]">
                          {autoRefreshEnabledDraft ? "Activado" : "Desactivado"}
                        </span>
                      </Switch.Content>
                      <Switch.Control className="shrink-0">
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch>
                    <div
                      className={`grid grid-cols-[minmax(0,1fr)_minmax(9rem,0.8fr)] gap-2 transition-opacity ${
                        autoRefreshEnabledDraft ? "" : "opacity-50"
                      }`}
                    >
                      <Input
                        aria-label="Cantidad entre actualizaciones"
                        disabled={!autoRefreshEnabledDraft}
                        max={String(
                          Math.floor(
                            MAX_AUTO_REFRESH_MINUTES /
                              AUTO_REFRESH_UNIT_MINUTES[autoRefreshDraftUnit],
                          ),
                        )}
                        min={autoRefreshDraftUnit === "m" ? "5" : "1"}
                        placeholder="5"
                        step="1"
                        type="number"
                        value={autoRefreshDraftAmount}
                        onChange={(event) => {
                          setAutoRefreshDraftAmount(event.target.value);
                          setAutoRefreshDraftError("");
                        }}
                      />
                      <Select
                        aria-label="Unidad entre actualizaciones"
                        isDisabled={!autoRefreshEnabledDraft}
                        value={autoRefreshDraftUnit}
                        onChange={(value) => {
                          if (value === null) return;
                          setAutoRefreshDraftUnit(value as AutoRefreshUnit);
                          setAutoRefreshDraftError("");
                        }}
                      >
                        <Select.Trigger className="h-10 w-full">
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="m" textValue="Minutos">
                              Minutos
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                            <ListBox.Item id="h" textValue="Horas">
                              Horas
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                            <ListBox.Item id="d" textValue="Días">
                              Días
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                    <p className="text-xs leading-5 text-[rgb(var(--app-muted))]">
                      Entre 5 minutos y 24 días; los intervalos cortos consumen
                      más cuota de GitHub.
                    </p>
                    {autoRefreshDraftError ? (
                      <p className="text-xs font-medium text-[rgb(var(--app-danger))]">
                        {autoRefreshDraftError}
                      </p>
                    ) : null}
                  </section>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  slot="close"
                  variant="outline"
                  onPress={() => setSettingsOpen(false)}
                >
                  Cerrar
                </Button>
                <Button
                  variant="primary"
                  className="bg-[#0070f3] text-white"
                  onPress={applySettingsDraft}
                >
                  Guardar ajustes
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
