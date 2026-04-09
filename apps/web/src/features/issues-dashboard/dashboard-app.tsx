"use client";

import {
  Button,
  Chip,
  Dropdown,
  Input,
  Modal,
  ScrollShadow,
  Spinner,
} from "@heroui/react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  CheckCircle2,
  Download,
  LayoutGrid,
  Loader2,
  LogOut,
  Monitor,
  MoonStar,
  PanelRightOpen,
  RefreshCw,
  RotateCcw,
  Settings2,
  SunMedium,
  Upload,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  type DragEvent,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

import {
  clearLocalSession,
  getIssuesSnapshot,
  isAuthenticationApiError,
  isConnectivityApiError,
  saveLocalSession,
  syncIssueStates,
  waitForLocalSessionStatus,
} from "@/features/issues-dashboard/api";
import { DashboardBoard } from "@/features/issues-dashboard/dashboard-board";
import {
  DescriptionModal,
  DesktopTitleBar,
  type SessionFormState,
  SessionScreen,
} from "@/features/issues-dashboard/dashboard-chrome";
import {
  buildSyncPayload,
  filterIssuesBySearch,
  normalizeNoteBlocks,
  PRIORITY_DEFINITIONS,
  sortIssuesByPinnedAndUpdated,
  THEME_DEFINITIONS,
} from "@/features/issues-dashboard/dashboard-helpers";
import type {
  ClosedWindowOption,
  DashboardIssue,
  DashboardSection,
  IssueLocalState,
  LocalSessionStatus,
  PriorityValue,
  SnapshotResponse,
  SyncStateItem,
} from "@/features/issues-dashboard/types";
import type { ThemeMode } from "@/types/desktop";

const STORAGE_KEYS = {
  closedWindow: "issues-dashboard:closed-window",
};
const LEGACY_SECTION_STORAGE_KEY = "issues-dashboard:section";

const DEFAULT_CLOSED_WINDOW = "1";

function readStoredPreference<T>(storageKey: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  const rawValue = window.localStorage.getItem(storageKey);
  if (!rawValue) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
}

function writeStoredPreference<T>(storageKey: string, value: T) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(value));
}

function clearStoredPreference(storageKey: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(storageKey);
}

function formatAbsoluteTimestamp(timestamp: string | null): string {
  if (!timestamp) {
    return "sin actividad reciente";
  }

  return format(new Date(timestamp), "dd/MM/yyyy HH:mm", { locale: es });
}

function getRemoteStateDotClassName(
  remoteState: DashboardIssue["remoteState"],
): string {
  return remoteState === "open"
    ? "bg-[rgb(var(--app-open))]"
    : "bg-[rgb(var(--app-closed))]";
}

function normalizeClosedWindowOption(
  rawValue: string,
  fallback: ClosedWindowOption = DEFAULT_CLOSED_WINDOW,
): ClosedWindowOption {
  const normalizedValue = rawValue.trim().toLowerCase();

  if (normalizedValue === "all") {
    return "all";
  }

  const parsedMonths = Number.parseInt(normalizedValue, 10);
  if (Number.isNaN(parsedMonths) || parsedMonths <= 0) {
    return fallback;
  }

  return String(parsedMonths) as ClosedWindowOption;
}

function formatClosedWindowLabel(closedWindow: ClosedWindowOption): string {
  if (closedWindow === "all") {
    return "Cerradas: todas";
  }

  if (closedWindow === "1") {
    return "Cerradas: 1 mes";
  }

  return `Cerradas: ${closedWindow} meses`;
}

function getThemeIcon(theme: ThemeMode, resolvedTheme?: string) {
  if (theme === "system") {
    return <Monitor size={16} />;
  }

  if (resolvedTheme === "dark") {
    return <MoonStar size={16} />;
  }

  return <SunMedium size={16} />;
}

function normalizeIssue(issue: DashboardIssue): DashboardIssue {
  return {
    ...issue,
    localState: {
      ...issue.localState,
      noteBlocks: normalizeNoteBlocks(issue.localState.noteBlocks),
    },
  };
}

function getLatestStableKeys(
  payload: SyncStateItem[],
  issues: DashboardIssue[],
): string[] {
  return payload.flatMap((item) => {
    const latestIssue = issues.find(
      (issue) => issue.issueKey === item.issueKey,
    );

    return latestIssue?.localState.lastInteractedAt ===
      item.state.lastInteractedAt
      ? [item.issueKey]
      : [];
  });
}

interface IssueUpdateOptions {
  flush?: boolean;
  trackDirty?: boolean;
}

interface ActiveDragElementState {
  boxShadow: string;
  element: HTMLElement;
  opacity: string;
  transform: string;
  transition: string;
}

export function DashboardApp() {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const [isDesktopRuntime, setIsDesktopRuntime] = useState(false);
  const [backendReady, setBackendReady] = useState(false);
  const [backendReadyError, setBackendReadyError] = useState("");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [section, setSection] = useState<DashboardSection>("board");
  const [closedWindow, setClosedWindow] = useState<ClosedWindowOption>(
    DEFAULT_CLOSED_WINDOW,
  );
  const [closedWindowDraft, setClosedWindowDraft] = useState(
    DEFAULT_CLOSED_WINDOW,
  );
  const [closedWindowDraftError, setClosedWindowDraftError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [issues, setIssues] = useState<DashboardIssue[]>([]);
  const issuesRef = useRef<DashboardIssue[]>([]);
  const activeDragElementRef = useRef<ActiveDragElementState | null>(null);
  const dragPreviewElementRef = useRef<HTMLElement | null>(null);
  const [snapshotData, setSnapshotData] = useState<SnapshotResponse | null>(
    null,
  );
  const snapshotDataRef = useRef<SnapshotResponse | null>(null);
  const snapshotRequestIdRef = useRef(0);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotFetching, setSnapshotFetching] = useState(false);
  const [snapshotError, setSnapshotError] = useState<Error | null>(null);
  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [dirtyIssueKeys, setDirtyIssueKeys] = useState<Set<string>>(new Set());
  const [syncingIssueKeys, setSyncingIssueKeys] = useState<Set<string>>(
    new Set(),
  );
  const [syncError, setSyncError] = useState("");
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionConfigured, setSessionConfigured] = useState(false);
  const [sessionUsername, setSessionUsername] = useState<string | null>(null);
  const [sessionEditing, setSessionEditing] = useState(false);
  const [sessionSaving, setSessionSaving] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [databaseTransferError, setDatabaseTransferError] = useState("");
  const [databaseTransferNotice, setDatabaseTransferNotice] = useState("");
  const [sessionForm, setSessionForm] = useState<SessionFormState>({
    token: "",
    username: "",
  });
  const snapshotEnabled = sessionConfigured && backendReady;

  const ensureDesktopBackendReady = useCallback(async (): Promise<boolean> => {
    if (!window.githubIssuesDesktop?.isElectron) {
      setBackendReady(true);
      return true;
    }

    setBackendReadyError("");

    try {
      const status = await window.githubIssuesDesktop.waitForBackendReady?.();
      const isReady = status?.ready ?? true;
      setBackendReady(isReady);
      return isReady;
    } catch (error) {
      setBackendReady(false);
      setBackendReadyError(
        error instanceof Error
          ? error.message
          : "No se pudo preparar el backend local.",
      );
      return false;
    }
  }, []);
  const cleanupDragArtifacts = useCallback(() => {
    if (activeDragElementRef.current) {
      const { boxShadow, element, opacity, transform, transition } =
        activeDragElementRef.current;

      element.style.boxShadow = boxShadow;
      element.style.opacity = opacity;
      element.style.transform = transform;
      element.style.transition = transition;
      activeDragElementRef.current = null;
    }

    dragPreviewElementRef.current?.remove();
    dragPreviewElementRef.current = null;
  }, []);
  const replaceIssues = useCallback((nextIssues: DashboardIssue[]) => {
    issuesRef.current = nextIssues;
    setIssues(nextIssues);
  }, []);
  const setSnapshotResult = useCallback(
    (nextSnapshot: SnapshotResponse | null) => {
      snapshotDataRef.current = nextSnapshot;
      setSnapshotData(nextSnapshot);
    },
    [],
  );

  useEffect(() => cleanupDragArtifacts, [cleanupDragArtifacts]);
  const loadSnapshot = useCallback(async () => {
    if (!snapshotEnabled) {
      return null;
    }

    const requestId = snapshotRequestIdRef.current + 1;
    snapshotRequestIdRef.current = requestId;
    setSnapshotError(null);
    setSnapshotFetching(true);
    setSnapshotLoading(snapshotDataRef.current === null);

    try {
      const nextSnapshot = await getIssuesSnapshot(closedWindow);

      if (requestId !== snapshotRequestIdRef.current) {
        return null;
      }

      setSnapshotResult(nextSnapshot);
      return nextSnapshot;
    } catch (error) {
      if (requestId !== snapshotRequestIdRef.current) {
        return null;
      }

      const loadError = isConnectivityApiError(error)
        ? new Error(
            "Sin conexión de red. Se muestran los datos locales guardados cuando están disponibles.",
          )
        : error instanceof Error
          ? error
          : new Error("La carga del snapshot ha fallado.");

      if (isAuthenticationApiError(loadError)) {
        replaceIssues([]);
        setSnapshotResult(null);
        setSelectedIssueKey(null);
        setDirtyIssueKeys(new Set());
        setSyncingIssueKeys(new Set());
        setSessionError(loadError.message);
        setSessionEditing(true);
      }

      setSnapshotError(loadError);
      return null;
    } finally {
      if (requestId === snapshotRequestIdRef.current) {
        setSnapshotFetching(false);
        setSnapshotLoading(false);
      }
    }
  }, [closedWindow, replaceIssues, setSnapshotResult, snapshotEnabled]);

  useEffect(() => {
    setIsDesktopRuntime(Boolean(window.githubIssuesDesktop?.isElectron));
    setSection("board");
    clearStoredPreference(LEGACY_SECTION_STORAGE_KEY);
    setClosedWindow(
      normalizeClosedWindowOption(
        readStoredPreference<string>(
          STORAGE_KEYS.closedWindow,
          DEFAULT_CLOSED_WINDOW,
        ),
      ),
    );
    setPreferencesReady(true);
  }, []);

  useEffect(() => {
    if (!snapshotEnabled) {
      snapshotRequestIdRef.current += 1;
      replaceIssues([]);
      setSnapshotResult(null);
      setSnapshotError(null);
      setSnapshotFetching(false);
      setSnapshotLoading(false);
      return;
    }

    void loadSnapshot();
  }, [loadSnapshot, replaceIssues, setSnapshotResult, snapshotEnabled]);

  useEffect(() => {
    if (!preferencesReady) {
      return;
    }

    writeStoredPreference(STORAGE_KEYS.closedWindow, closedWindow);
  }, [closedWindow, preferencesReady]);

  useEffect(() => {
    if (closedWindow !== "all") {
      setClosedWindowDraft(closedWindow);
    }
  }, [closedWindow]);

  useEffect(() => {
    async function loadSessionStatus() {
      if (!window.githubIssuesDesktop?.isElectron) {
        try {
          const status = await waitForLocalSessionStatus();
          setSessionConfigured(status.configured);
          setSessionUsername(status.username);
          setSessionForm((current) => ({
            ...current,
            token: "",
            username: status.username ?? current.username,
          }));
          setBackendReady(true);
        } catch (error) {
          setSessionConfigured(false);
          setSessionUsername(null);
          setBackendReady(false);
          setBackendReadyError(
            error instanceof Error
              ? error.message
              : "No se pudo conectar con el backend local.",
          );
        } finally {
          setSessionLoading(false);
        }

        return;
      }

      try {
        const status = await window.githubIssuesDesktop.getSessionStatus?.();

        if (!status?.configured) {
          setSessionConfigured(false);
          setSessionUsername(status?.username ?? null);
          setBackendReady(false);
          return;
        }

        setSessionConfigured(true);
        setSessionUsername(status.username);
        setSessionForm((current) => ({
          ...current,
          token: "",
          username: status.username ?? current.username,
        }));

        const backendStatus =
          await window.githubIssuesDesktop.getBackendStatus?.();

        if (backendStatus?.ready) {
          setBackendReady(true);
          return;
        }

        await ensureDesktopBackendReady();
      } catch (error) {
        setSessionConfigured(false);
        setBackendReady(false);
        setSessionError(
          error instanceof Error
            ? error.message
            : "No se pudo leer el estado de la sesión.",
        );
      } finally {
        setSessionLoading(false);
      }
    }

    void loadSessionStatus();
  }, [ensureDesktopBackendReady]);

  useEffect(() => {
    if (!window.githubIssuesDesktop?.setTitleBarTheme) {
      return;
    }

    const themeValue = (theme ?? "system") as ThemeMode;
    void window.githubIssuesDesktop.setTitleBarTheme(themeValue);
  }, [theme]);

  useEffect(() => {
    if (!isDesktopRuntime || !window.githubIssuesDesktop?.getWindowState) {
      setIsWindowMaximized(false);
      return;
    }

    let canceled = false;

    void window.githubIssuesDesktop
      .getWindowState()
      .then((windowState) => {
        if (canceled) {
          return;
        }

        setIsWindowMaximized(Boolean(windowState?.isMaximized));
      })
      .catch(() => {
        if (canceled) {
          return;
        }

        setIsWindowMaximized(false);
      });

    return () => {
      canceled = true;
    };
  }, [isDesktopRuntime]);

  useEffect(() => {
    if (!snapshotData) {
      return;
    }

    const normalizedIssues = snapshotData.issues.map(normalizeIssue);
    startTransition(() => {
      replaceIssues(normalizedIssues);
    });
    setDirtyIssueKeys(new Set());
    setSyncingIssueKeys(new Set());

    setSelectedIssueKey((currentSelectedIssueKey) => {
      if (!currentSelectedIssueKey) {
        return currentSelectedIssueKey;
      }

      const stillExists = normalizedIssues.some(
        (issue) => issue.issueKey === currentSelectedIssueKey,
      );
      return stillExists ? currentSelectedIssueKey : null;
    });
  }, [replaceIssues, snapshotData]);

  const persistPayload = useCallback(async (payload: SyncStateItem[]) => {
    if (payload.length === 0) {
      return;
    }

    const payloadIssueKeys = payload.map((item) => item.issueKey);
    setPendingSyncCount((currentCount) => currentCount + 1);
    setSyncingIssueKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys);

      for (const issueKey of payloadIssueKeys) {
        nextKeys.add(issueKey);
      }

      return nextKeys;
    });
    setSyncError("");

    try {
      await syncIssueStates(payload);

      const latestStableKeys = getLatestStableKeys(payload, issuesRef.current);
      if (latestStableKeys.length === 0) {
        return;
      }

      setDirtyIssueKeys((currentDirtyKeys) => {
        const nextDirtyKeys = new Set(currentDirtyKeys);

        for (const issueKey of latestStableKeys) {
          nextDirtyKeys.delete(issueKey);
        }

        return nextDirtyKeys;
      });
    } catch (error) {
      setSyncError(
        isConnectivityApiError(error)
          ? "Sin conexión de red. Tus cambios quedan en local y se reintentará sincronizar automáticamente."
          : error instanceof Error
            ? error.message
            : "No se pudieron guardar los cambios locales.",
      );
    } finally {
      setPendingSyncCount((currentCount) => Math.max(0, currentCount - 1));
      setSyncingIssueKeys((currentKeys) => {
        const nextKeys = new Set(currentKeys);

        for (const issueKey of payloadIssueKeys) {
          nextKeys.delete(issueKey);
        }

        return nextKeys;
      });
    }
  }, []);

  useEffect(() => {
    const debouncedIssueKeys = [...dirtyIssueKeys].filter(
      (issueKey) => !syncingIssueKeys.has(issueKey),
    );

    if (debouncedIssueKeys.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const pendingPayload = buildSyncPayload(
        issuesRef.current,
        debouncedIssueKeys,
      );
      void persistPayload(pendingPayload);
    }, 280);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [dirtyIssueKeys, persistPayload, syncingIssueKeys]);

  const activeIssue = useMemo(
    () => issues.find((issue) => issue.issueKey === selectedIssueKey) ?? null,
    [issues, selectedIssueKey],
  );

  const boardIssues = useMemo(
    () => issues.filter((issue) => issue.localState.localCompletedAt === null),
    [issues],
  );

  const backlogIssues = useMemo(
    () =>
      filterIssuesBySearch(
        boardIssues.filter((issue) => issue.localState.priority === null),
        deferredSearch,
      ),
    [boardIssues, deferredSearch],
  );

  const completedIssues = useMemo(() => {
    const filteredIssues = filterIssuesBySearch(
      issues.filter((issue) => issue.localState.localCompletedAt !== null),
      deferredSearch,
    );

    return [...filteredIssues].sort((left, right) => {
      const leftTimestamp = Date.parse(
        left.localState.localCompletedAt ?? left.syncedAt,
      );
      const rightTimestamp = Date.parse(
        right.localState.localCompletedAt ?? right.syncedAt,
      );

      return rightTimestamp - leftTimestamp;
    });
  }, [deferredSearch, issues]);

  const priorityBuckets = useMemo(
    () =>
      PRIORITY_DEFINITIONS.map((definition) => ({
        ...definition,
        issues: sortIssuesByPinnedAndUpdated(
          filterIssuesBySearch(
            boardIssues.filter(
              (issue) => issue.localState.priority === definition.value,
            ),
            deferredSearch,
          ),
        ),
      })),
    [boardIssues, deferredSearch],
  );

  const currentTheme = (theme ?? "system") as ThemeMode;
  const isSyncing = pendingSyncCount > 0;
  const snapshotConnectivityNotice =
    snapshotError && issues.length > 0 && isConnectivityApiError(snapshotError)
      ? "Sin conexión de red. Mostrando datos locales guardados; puedes seguir trabajando en local."
      : "";
  const topbarStatusMessage =
    syncError ||
    backendReadyError ||
    databaseTransferError ||
    snapshotConnectivityNotice ||
    databaseTransferNotice ||
    (isSyncing ? "Actualizando dashboard..." : "");
  const topbarHasError = Boolean(
    syncError || backendReadyError || databaseTransferError,
  );
  const topbarHasWarning =
    !topbarHasError && Boolean(snapshotConnectivityNotice);
  const topbarShowSpinner = isSyncing && !topbarHasError && !topbarHasWarning;
  const showSessionScreen =
    !sessionLoading &&
    (!sessionConfigured || sessionEditing) &&
    (isDesktopRuntime || backendReady);
  const handleCollapseSidebar = useCallback(() => {
    setIsSidebarCollapsed(true);
  }, []);
  const handleIssueSelect = useCallback((issueKey: string) => {
    setSelectedIssueKey(issueKey);
    setIsSidebarCollapsed(false);
  }, []);
  const handleOpenDescription = useCallback(() => {
    setDescriptionOpen(true);
  }, []);
  const minimizeDesktopWindow = useCallback(() => {
    void window.githubIssuesDesktop?.minimizeWindow?.();
  }, []);
  const toggleDesktopMaximize = useCallback(() => {
    void window.githubIssuesDesktop
      ?.toggleMaximizeWindow?.()
      .then((windowState) => {
        if (!windowState) {
          return;
        }

        setIsWindowMaximized(Boolean(windowState.isMaximized));
      })
      .catch(() => {
        // Keep current local state when maximize toggle fails.
      });
  }, []);
  const closeDesktopWindow = useCallback(() => {
    void window.githubIssuesDesktop?.closeWindow?.();
  }, []);

  function updateIssue(
    issueKey: string,
    updater: (issue: DashboardIssue) => DashboardIssue,
    options: IssueUpdateOptions = {},
  ) {
    const interactionTimestamp = new Date().toISOString();
    const nextIssues = issuesRef.current.map((issue) => {
      if (issue.issueKey !== issueKey) {
        return issue;
      }

      const nextIssue = updater(issue);
      return {
        ...nextIssue,
        localState: {
          ...nextIssue.localState,
          lastInteractedAt: interactionTimestamp,
        },
      };
    });

    if (options.flush) {
      flushSync(() => {
        replaceIssues(nextIssues);
      });
    } else {
      replaceIssues(nextIssues);
    }

    const shouldTrackDirty = options.trackDirty ?? true;
    if (!shouldTrackDirty) {
      return;
    }

    setDirtyIssueKeys((currentDirtyKeys) => {
      const nextDirtyKeys = new Set(currentDirtyKeys);
      nextDirtyKeys.add(issueKey);
      return nextDirtyKeys;
    });
  }

  function updateIssueLocalState(
    issueKey: string,
    updater: (state: IssueLocalState) => IssueLocalState,
    options: IssueUpdateOptions = {},
  ) {
    updateIssue(
      issueKey,
      (issue) => ({
        ...issue,
        localState: updater(issue.localState),
      }),
      options,
    );
  }

  async function persistSingleIssueMutation(issueKey: string) {
    const payload = buildSyncPayload(issuesRef.current, [issueKey]);
    if (payload.length === 0) {
      return;
    }

    const [syncItem] = payload;
    setPendingSyncCount((currentCount) => currentCount + 1);
    setSyncingIssueKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys);
      nextKeys.add(issueKey);
      return nextKeys;
    });
    setSyncError("");

    try {
      await syncIssueStates([syncItem]);

      const latestStableKeys = getLatestStableKeys(
        [syncItem],
        issuesRef.current,
      );
      if (latestStableKeys.length > 0) {
        setDirtyIssueKeys((currentDirtyKeys) => {
          const nextDirtyKeys = new Set(currentDirtyKeys);

          for (const stableIssueKey of latestStableKeys) {
            nextDirtyKeys.delete(stableIssueKey);
          }

          return nextDirtyKeys;
        });
      }
    } catch (error) {
      setDirtyIssueKeys((currentDirtyKeys) => {
        const nextDirtyKeys = new Set(currentDirtyKeys);
        nextDirtyKeys.add(issueKey);
        return nextDirtyKeys;
      });

      setSyncError(
        isConnectivityApiError(error)
          ? "Sin conexión de red. Tus cambios quedan en local y se reintentará sincronizar automáticamente."
          : error instanceof Error
            ? error.message
            : "No se pudieron guardar los cambios locales.",
      );
    } finally {
      setPendingSyncCount((currentCount) => Math.max(0, currentCount - 1));
      setSyncingIssueKeys((currentKeys) => {
        const nextKeys = new Set(currentKeys);
        nextKeys.delete(issueKey);
        return nextKeys;
      });
    }
  }

  function setIssuePriority(issueKey: string, priority: PriorityValue | null) {
    const currentIssue = issuesRef.current.find(
      (issue) => issue.issueKey === issueKey,
    );

    if (
      currentIssue?.localState.priority === priority &&
      !(priority === null && currentIssue.localState.isPinned)
    ) {
      return;
    }

    updateIssueLocalState(
      issueKey,
      (localState) => ({
        ...localState,
        isPinned: priority === null ? false : localState.isPinned,
        priority,
      }),
      { flush: true, trackDirty: false },
    );
    void persistSingleIssueMutation(issueKey);
  }

  function handleIssueDragStart(
    event: DragEvent<HTMLElement>,
    issueKey: string,
  ) {
    cleanupDragArtifacts();
    event.dataTransfer.setData("issue-key", issueKey);
    event.dataTransfer.effectAllowed = "move";
    const dragElement = event.currentTarget;
    const dragElementRect = dragElement.getBoundingClientRect();

    activeDragElementRef.current = {
      boxShadow: dragElement.style.boxShadow,
      element: dragElement,
      opacity: dragElement.style.opacity,
      transform: dragElement.style.transform,
      transition: dragElement.style.transition,
    };

    dragElement.style.boxShadow =
      "0 20px 38px -22px rgba(0,0,0,0.62), 0 10px 18px -12px rgba(0,0,0,0.42)";
    dragElement.style.opacity = "0.94";
    dragElement.style.transform = "translateY(-1px) scale(1.012)";
    dragElement.style.transition = "none";

    const previewElement = dragElement.cloneNode(true) as HTMLElement;
    previewElement.style.boxShadow = dragElement.style.boxShadow;
    previewElement.style.left = "-9999px";
    previewElement.style.margin = "0";
    previewElement.style.opacity = "0.98";
    previewElement.style.pointerEvents = "none";
    previewElement.style.position = "fixed";
    previewElement.style.top = "-9999px";
    previewElement.style.transform = "rotate(1.4deg) scale(1.01)";
    previewElement.style.width = `${String(dragElementRect.width)}px`;
    previewElement.style.zIndex = "2147483647";

    document.body.append(previewElement);
    dragPreviewElementRef.current = previewElement;
    event.dataTransfer.setDragImage(
      previewElement,
      Math.min(52, dragElementRect.width * 0.28),
      20,
    );
  }

  function handleIssueDragEnd() {
    cleanupDragArtifacts();
  }

  function handleIssueDrop(
    event: DragEvent<HTMLElement>,
    priority: PriorityValue | null,
  ) {
    event.preventDefault();
    const issueKey = event.dataTransfer.getData("issue-key");

    if (!issueKey) {
      cleanupDragArtifacts();
      return;
    }

    setIssuePriority(issueKey, priority);
    cleanupDragArtifacts();
  }

  function toggleIssuePin(issueKey: string) {
    updateIssueLocalState(
      issueKey,
      (localState) => ({
        ...localState,
        isPinned: !localState.isPinned,
      }),
      { trackDirty: false },
    );
    void persistSingleIssueMutation(issueKey);
  }

  function completeIssue(issueKey: string) {
    updateIssueLocalState(
      issueKey,
      (localState) => ({
        ...localState,
        isPinned: false,
        lastPinnedBeforeCompletion: localState.isPinned,
        lastPriorityBeforeCompletion: localState.priority,
        localCompletedAt: new Date().toISOString(),
        priority: null,
      }),
      { flush: true, trackDirty: false },
    );
    void persistSingleIssueMutation(issueKey);
    setSelectedIssueKey(null);
    setSection("board");
  }

  function restoreIssue(issueKey: string) {
    updateIssueLocalState(
      issueKey,
      (localState) => ({
        ...localState,
        isPinned: localState.lastPinnedBeforeCompletion,
        lastPinnedBeforeCompletion: false,
        lastPriorityBeforeCompletion: null,
        localCompletedAt: null,
        priority: localState.lastPriorityBeforeCompletion,
      }),
      { flush: true, trackDirty: false },
    );
    void persistSingleIssueMutation(issueKey);
    setSection("board");
  }

  function updateIssueBlocks(
    issueKey: string,
    nextBlocks: DashboardIssue["localState"]["noteBlocks"],
  ) {
    updateIssueLocalState(issueKey, (localState) => ({
      ...localState,
      noteBlocks: normalizeNoteBlocks(nextBlocks),
    }));
  }

  async function handleRefreshSnapshot() {
    setBackendReadyError("");

    if (!backendReady) {
      const isReady = isDesktopRuntime
        ? sessionConfigured
          ? await ensureDesktopBackendReady()
          : true
        : Boolean(await waitForLocalSessionStatus().catch(() => null));

      if (!isReady) {
        setBackendReadyError("No se pudo conectar con el backend local.");
        return;
      }

      setBackendReady(true);
    }

    await loadSnapshot();
  }

  async function saveSession() {
    setSessionSaving(true);
    setSessionError("");
    setBackendReadyError("");

    try {
      const payload = {
        token: sessionForm.token.trim(),
        username: sessionForm.username.trim(),
      };
      let status: LocalSessionStatus;

      if (isDesktopRuntime) {
        if (!window.githubIssuesDesktop?.saveSession) {
          return;
        }

        setBackendReady(false);
        status = await window.githubIssuesDesktop.saveSession(payload);
      } else {
        status = await saveLocalSession(payload);
        setBackendReady(true);
      }

      setSessionConfigured(status.configured);
      setSessionUsername(status.username);
      setSessionEditing(false);
      setSessionForm((current) => ({
        token: "",
        username: status.username ?? current.username,
      }));

      if (isDesktopRuntime) {
        await ensureDesktopBackendReady();
      }
    } catch (error) {
      setSessionError(
        error instanceof Error
          ? error.message
          : "No se pudo guardar la sesión local.",
      );
    } finally {
      setSessionSaving(false);
    }
  }

  async function clearSession() {
    setSessionSaving(true);
    setSessionError("");
    setBackendReadyError("");

    try {
      let status: LocalSessionStatus;

      if (isDesktopRuntime) {
        if (!window.githubIssuesDesktop?.clearSession) {
          return;
        }

        status = await window.githubIssuesDesktop.clearSession();
        setBackendReady(false);
      } else {
        status = await clearLocalSession();
        setBackendReady(true);
      }

      setSessionConfigured(status.configured);
      setSessionUsername(status.username);
      setSessionEditing(false);
      setSessionForm({
        token: "",
        username: status.username ?? "",
      });
      replaceIssues([]);
      setSnapshotResult(null);
      setSnapshotError(null);
      setSnapshotFetching(false);
      setSnapshotLoading(false);
      setSelectedIssueKey(null);
      setDirtyIssueKeys(new Set());
      setSyncingIssueKeys(new Set());
    } catch (error) {
      setSessionError(
        error instanceof Error
          ? error.message
          : "No se pudo limpiar la sesión local.",
      );
    } finally {
      setSessionSaving(false);
    }
  }

  async function exportDatabase() {
    if (!window.githubIssuesDesktop?.exportDatabase) {
      return;
    }

    setDatabaseTransferError("");
    setDatabaseTransferNotice("");

    try {
      const result = await window.githubIssuesDesktop.exportDatabase();
      if (result?.cancelled) {
        return;
      }

      setDatabaseTransferNotice(
        result?.path
          ? `Base de datos exportada en ${result.path}.`
          : "Base de datos exportada correctamente.",
      );
    } catch (error) {
      setDatabaseTransferError(
        error instanceof Error
          ? error.message
          : "No se pudo exportar la base de datos. Intentalo de nuevo.",
      );
    }
  }

  async function importDatabase() {
    if (!window.githubIssuesDesktop?.importDatabase) {
      return;
    }

    setDatabaseTransferError("");
    setDatabaseTransferNotice("");

    try {
      const result = await window.githubIssuesDesktop.importDatabase();
      if (result?.cancelled) {
        return;
      }

      await handleRefreshSnapshot();
      setDatabaseTransferNotice(
        result?.path
          ? `Base de datos importada desde ${result.path}.`
          : "Base de datos importada correctamente.",
      );
    } catch (error) {
      setDatabaseTransferError(
        error instanceof Error
          ? error.message
          : "No se pudo importar la base de datos. Intentalo de nuevo.",
      );
    }
  }

  function cycleTheme() {
    const currentIndex = THEME_DEFINITIONS.findIndex(
      (definition) => definition.value === currentTheme,
    );
    const nextTheme =
      THEME_DEFINITIONS[(currentIndex + 1) % THEME_DEFINITIONS.length];
    setTheme(nextTheme.value);
  }

  function applyClosedWindow(closedWindowValue: ClosedWindowOption) {
    setClosedWindow(closedWindowValue);
    setClosedWindowDraftError("");
  }

  function applyClosedWindowDraft() {
    const parsedMonths = Number.parseInt(closedWindowDraft.trim(), 10);

    if (Number.isNaN(parsedMonths) || parsedMonths <= 0) {
      setClosedWindowDraftError("Indica un número entero positivo.");
      return;
    }

    applyClosedWindow(String(parsedMonths) as ClosedWindowOption);
    setSettingsOpen(false);
  }

  if (sessionLoading) {
    return (
      <>
        {isDesktopRuntime ? (
          <div className="fixed left-2.5 right-2.5 top-2.5 z-40">
            <DesktopTitleBar
              isMaximized={isWindowMaximized}
              onClose={closeDesktopWindow}
              onMinimize={minimizeDesktopWindow}
              onToggleMaximize={toggleDesktopMaximize}
            />
          </div>
        ) : null}

        <main
          className={`flex min-h-screen items-center justify-center p-4 ${
            isDesktopRuntime ? "pt-14" : ""
          }`}
        >
          <div className="inline-flex items-center gap-3 rounded-full border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/95 px-4 py-3 text-sm text-[rgb(var(--app-muted))]">
            <Spinner size="sm" />
            Cargando sesión local...
          </div>
        </main>
      </>
    );
  }

  if (showSessionScreen) {
    return (
      <>
        {isDesktopRuntime ? (
          <div className="fixed left-2.5 right-2.5 top-2.5 z-40">
            <DesktopTitleBar
              isMaximized={isWindowMaximized}
              onClose={closeDesktopWindow}
              onMinimize={minimizeDesktopWindow}
              onToggleMaximize={toggleDesktopMaximize}
            />
          </div>
        ) : null}

        <SessionScreen
          errorMessage={sessionError}
          form={sessionForm}
          isEditing={sessionEditing}
          isSaving={sessionSaving}
          onCancel={() => setSessionEditing(false)}
          onChange={(field, value) =>
            setSessionForm((current) => ({ ...current, [field]: value }))
          }
          onSave={saveSession}
          topInset={isDesktopRuntime}
        />
      </>
    );
  }

  const viewportClassName = "h-full";

  return (
    <>
      <main className="h-screen overflow-hidden p-2.5">
        <div
          className={`flex w-full min-w-0 flex-col gap-2 ${viewportClassName}`}
        >
          {isDesktopRuntime ? (
            <DesktopTitleBar
              isMaximized={isWindowMaximized}
              onClose={closeDesktopWindow}
              onMinimize={minimizeDesktopWindow}
              onToggleMaximize={toggleDesktopMaximize}
            />
          ) : null}

          <header className="rounded-[1rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/96 px-3 py-1.5 shadow-sm">
            <div className="flex min-h-[2.3rem] flex-wrap items-center gap-1.5">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <div className="flex gap-1 rounded-[0.9rem] border border-[rgb(var(--app-border))]/75 bg-[rgb(var(--app-surface-strong))]/95 p-0.5">
                  <Button
                    size="sm"
                    variant={section === "board" ? "primary" : "ghost"}
                    className={
                      section === "board"
                        ? "rounded-[0.75rem] bg-[rgb(var(--app-accent))]/14 px-3 text-[rgb(var(--app-accent-strong))]"
                        : "rounded-[0.75rem] px-3"
                    }
                    onPress={() => setSection("board")}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <LayoutGrid size={14} />
                      <span>Dashboard</span>
                    </span>
                  </Button>
                  <Button
                    size="sm"
                    variant={section === "completed" ? "primary" : "ghost"}
                    className={
                      section === "completed"
                        ? "rounded-[0.75rem] bg-[rgb(var(--app-open))]/14 px-3 text-[rgb(var(--app-open))]"
                        : "rounded-[0.75rem] px-3"
                    }
                    onPress={() => setSection("completed")}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <CheckCircle2 size={14} />
                      <span>Completadas</span>
                    </span>
                  </Button>
                </div>

                {topbarStatusMessage ? (
                  <span
                    className={`inline-flex max-w-[30rem] items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap rounded-[0.8rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/90 px-2.5 py-1 text-[11px] font-medium ${
                      topbarHasError
                        ? "text-[rgb(var(--app-danger))]"
                        : topbarHasWarning
                          ? "text-[#d97706]"
                          : "text-[rgb(var(--app-muted))]"
                    }`}
                  >
                    {topbarShowSpinner ? (
                      <Loader2 className="animate-spin" size={12} />
                    ) : null}
                    <span className="truncate">{topbarStatusMessage}</span>
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-1">
                {activeIssue && isSidebarCollapsed ? (
                  <Button
                    isIconOnly
                    aria-label="Mostrar panel de notas"
                    size="sm"
                    variant="outline"
                    onPress={() => setIsSidebarCollapsed(false)}
                  >
                    <PanelRightOpen size={16} />
                  </Button>
                ) : null}

                <Button
                  isIconOnly
                  aria-label="Ajustes de cerradas"
                  size="sm"
                  variant="outline"
                  onPress={() => setSettingsOpen(true)}
                >
                  <Settings2 size={16} />
                </Button>
                <Button
                  isIconOnly
                  aria-label="Cambiar tema"
                  size="sm"
                  variant="outline"
                  onPress={cycleTheme}
                >
                  {getThemeIcon(currentTheme, resolvedTheme)}
                </Button>
                <Button
                  isIconOnly
                  aria-label="Refrescar issues"
                  size="sm"
                  variant="outline"
                  onPress={() => void handleRefreshSnapshot()}
                >
                  <RefreshCw
                    className={snapshotFetching ? "animate-spin" : ""}
                    size={16}
                  />
                </Button>

                {sessionConfigured ? (
                  <Dropdown>
                    <Dropdown.Trigger className="button button--sm button--outline rounded-[0.8rem] px-2.5">
                      <span
                        className="inline-flex items-center"
                        title={sessionUsername ?? "Cuenta local"}
                      >
                        <UserRound size={16} />
                      </span>
                    </Dropdown.Trigger>
                    <Dropdown.Popover>
                      <Dropdown.Menu
                        aria-label="Acciones de sesión"
                        onAction={(selectionKey) => {
                          if (selectionKey === "edit") {
                            setSessionEditing(true);
                            setSessionForm((current) => ({
                              ...current,
                              token: "",
                            }));
                          }

                          if (selectionKey === "logout") {
                            void clearSession();
                          }

                          if (selectionKey === "export-db") {
                            void exportDatabase();
                          }

                          if (selectionKey === "import-db") {
                            void importDatabase();
                          }
                        }}
                      >
                        <Dropdown.Item id="edit" textValue="Editar sesión">
                          <div className="flex items-center gap-2">
                            <Settings2 size={15} />
                            Editar sesión
                          </div>
                        </Dropdown.Item>
                        {isDesktopRuntime ? (
                          <Dropdown.Item
                            id="export-db"
                            textValue="Exportar base de datos"
                          >
                            <div className="flex items-center gap-2">
                              <Download size={15} />
                              Exportar base de datos
                            </div>
                          </Dropdown.Item>
                        ) : null}
                        {isDesktopRuntime ? (
                          <Dropdown.Item
                            id="import-db"
                            textValue="Importar base de datos"
                          >
                            <div className="flex items-center gap-2">
                              <Upload size={15} />
                              Importar base de datos
                            </div>
                          </Dropdown.Item>
                        ) : null}
                        <Dropdown.Item id="logout" textValue="Cerrar sesión">
                          <div className="flex items-center gap-2 text-[rgb(var(--app-danger))]">
                            <LogOut size={15} />
                            Cerrar sesión
                          </div>
                        </Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown.Popover>
                  </Dropdown>
                ) : null}
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1">
            {section === "board" ? (
              !backendReady && backendReadyError ? (
                <div className="flex h-full items-center justify-center rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/95 p-6">
                  <div className="max-w-xl rounded-[1.1rem] border border-[rgb(var(--app-danger))]/30 bg-[rgb(var(--app-danger))]/10 px-5 py-4 text-sm text-[rgb(var(--app-danger))]">
                    <p className="font-semibold">
                      No se pudo arrancar el backend local.
                    </p>
                    <p className="mt-1">{backendReadyError}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      onPress={() => void handleRefreshSnapshot()}
                    >
                      Reintentar
                    </Button>
                  </div>
                </div>
              ) : !backendReady ? (
                <div className="flex h-full items-center justify-center rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/95 p-6">
                  <div className="inline-flex items-center gap-3 rounded-full border border-[rgb(var(--app-border))]/70 px-4 py-3 text-sm text-[rgb(var(--app-muted))]">
                    <Spinner size="sm" />
                    Preparando el backend local...
                  </div>
                </div>
              ) : snapshotLoading && issues.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/95 p-6">
                  <div className="inline-flex items-center gap-3 rounded-full border border-[rgb(var(--app-border))]/70 px-4 py-3 text-sm text-[rgb(var(--app-muted))]">
                    <Spinner size="sm" />
                    Preparando tu tablero de issues...
                  </div>
                </div>
              ) : snapshotError && issues.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/95 p-6">
                  <div className="max-w-xl rounded-[1.1rem] border border-[rgb(var(--app-danger))]/30 bg-[rgb(var(--app-danger))]/10 px-5 py-4 text-sm text-[rgb(var(--app-danger))]">
                    <p className="font-semibold">
                      No se pudieron cargar las issues.
                    </p>
                    <p className="mt-1">{snapshotError.message}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      onPress={() => void handleRefreshSnapshot()}
                    >
                      Reintentar
                    </Button>
                  </div>
                </div>
              ) : issues.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/95 p-6">
                  <div className="max-w-lg rounded-[1.1rem] border border-dashed border-[rgb(var(--app-border))]/70 px-5 py-8 text-center text-sm text-[rgb(var(--app-muted))]">
                    <p className="text-base font-semibold text-[rgb(var(--app-foreground))]">
                      No hay issues asignadas visibles.
                    </p>
                    <p className="mt-2">
                      Si esperabas ver tareas aquí, revisa el token o pulsa
                      refrescar para volver a consultar GitHub.
                    </p>
                  </div>
                </div>
              ) : (
                <DashboardBoard
                  activeIssue={activeIssue}
                  backlogIssues={backlogIssues}
                  isSidebarCollapsed={isSidebarCollapsed}
                  priorityBuckets={priorityBuckets}
                  search={search}
                  selectedIssueKey={selectedIssueKey}
                  onCollapseSidebar={handleCollapseSidebar}
                  onCompleteIssue={completeIssue}
                  onIssueDragEnd={handleIssueDragEnd}
                  onIssueDragStart={handleIssueDragStart}
                  onIssueDrop={handleIssueDrop}
                  onIssueSelect={handleIssueSelect}
                  onOpenDescription={handleOpenDescription}
                  onSearchChange={setSearch}
                  onSetPriority={setIssuePriority}
                  onTogglePin={toggleIssuePin}
                  onUpdateBlocks={updateIssueBlocks}
                />
              )
            ) : (
              <div className="flex h-full flex-col rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/95">
                <div className="border-b border-[rgb(var(--app-border))]/55 px-4 py-3">
                  <h2 className="text-sm font-semibold text-[rgb(var(--app-foreground))]">
                    Completadas
                  </h2>
                </div>

                <ScrollShadow
                  hideScrollBar
                  className="app-scrollbar min-h-0 flex-1 px-4 py-4"
                >
                  <div className="space-y-3 pb-6">
                    {completedIssues.length === 0 ? (
                      <div className="rounded-[1.1rem] border border-dashed border-[rgb(var(--app-border))]/70 px-5 py-10 text-center text-sm text-[rgb(var(--app-muted))]">
                        No hay issues completadas todavía.
                      </div>
                    ) : (
                      completedIssues.map((issue) => (
                        <article
                          key={issue.issueKey}
                          className="relative rounded-[1rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/88 px-4 py-3"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-medium text-[rgb(var(--app-muted))]">
                                {issue.repository.fullName} #{issue.number}
                              </div>
                              <h3 className="mt-1.5 text-[15px] font-semibold leading-5 text-[rgb(var(--app-foreground))]">
                                {issue.title}
                              </h3>
                              <div className="mt-2 text-xs text-[rgb(var(--app-muted))]">
                                Completada el{" "}
                                {formatAbsoluteTimestamp(
                                  issue.localState.localCompletedAt,
                                )}
                              </div>
                            </div>

                            <div className="flex shrink-0 flex-col items-end gap-2 pt-0.5">
                              <span
                                aria-hidden
                                className={`h-2.5 w-2.5 rounded-full ${getRemoteStateDotClassName(issue.remoteState)}`}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onPress={() => restoreIssue(issue.issueKey)}
                              >
                                <span className="inline-flex items-center gap-2">
                                  <RotateCcw size={15} />
                                  <span>Restaurar</span>
                                </span>
                              </Button>
                            </div>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </ScrollShadow>
              </div>
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
          <Modal.Container size="md">
            <Modal.Dialog className="border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Ajustes de issues cerradas</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <div className="space-y-4 px-1">
                  <p className="text-sm text-[rgb(var(--app-muted))]">
                    Elige si quieres ver todas las cerradas o limitar la vista
                    por un número manual de meses.
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant={closedWindow === "all" ? "primary" : "outline"}
                      className={
                        closedWindow === "all"
                          ? "bg-[rgb(var(--app-accent))] text-white"
                          : ""
                      }
                      onPress={() => {
                        applyClosedWindow("all");
                        setSettingsOpen(false);
                      }}
                    >
                      Mostrar todas
                    </Button>
                    <Chip
                      className="border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/90 text-[rgb(var(--app-muted))]"
                      variant="secondary"
                    >
                      {formatClosedWindowLabel(closedWindow)}
                    </Chip>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-[rgb(var(--app-foreground))]">
                      Límite manual en meses
                    </p>
                    <Input
                      aria-label="Número de meses para issues cerradas"
                      placeholder="6"
                      type="number"
                      className="w-full"
                      value={closedWindowDraft}
                      onChange={(event) => {
                        setClosedWindowDraft(event.target.value);
                        setClosedWindowDraftError("");
                      }}
                    />
                    <p className="text-xs text-[rgb(var(--app-muted))]">
                      Introduce cualquier entero positivo. Ejemplo: 2, 9 o 18.
                    </p>
                    {closedWindowDraftError ? (
                      <p className="text-xs font-medium text-[rgb(var(--app-danger))]">
                        {closedWindowDraftError}
                      </p>
                    ) : null}
                  </div>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="outline">
                  Cerrar
                </Button>
                <Button variant="primary" onPress={applyClosedWindowDraft}>
                  Aplicar meses
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <DescriptionModal
        issue={activeIssue}
        isOpen={descriptionOpen}
        onOpenChange={setDescriptionOpen}
      />
    </>
  );
}
