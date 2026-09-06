"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearLocalSession,
  getIssueDetail,
  getIssuesSnapshot,
  isAuthenticationApiError,
  isConnectivityApiError,
  saveLocalSession,
  syncIssueStates,
  waitForLocalSessionStatus,
} from "@/features/issues-dashboard/api";
import type {
  ClosedWindowOption,
  DashboardIssue,
  IssueLocalState,
  LocalSessionStatus,
  PriorityValue,
  SnapshotResponse,
  SyncStateItem,
} from "@/features/issues-dashboard/types";
import {
  buildSyncPayload,
  normalizeNoteBlocks,
} from "@/features/issues-dashboard/utils/dashboard-helpers";

export interface SessionFormState {
  token: string;
}

function normalizeIssue(issue: DashboardIssue): DashboardIssue {
  const status =
    issue.localState?.status ??
    (issue.localState?.localCompletedAt ? "completed" : "active");

  return {
    ...issue,
    localState: {
      ...issue.localState,
      status,
      noteBlocks: normalizeNoteBlocks(issue.localState?.noteBlocks),
    },
  };
}

function getLatestStableKeys(
  payload: SyncStateItem[],
  issues: DashboardIssue[],
): string[] {
  const interactedAtByIssue = new Map(
    issues.map((issue) => [issue.issueKey, issue.localState.lastInteractedAt]),
  );

  return payload.flatMap((item) => {
    return interactedAtByIssue.get(item.issueKey) ===
      item.state.lastInteractedAt
      ? [item.issueKey]
      : [];
  });
}

export function useIssueSync(closedWindow: ClosedWindowOption) {
  const [backendReady, setBackendReady] = useState(false);
  const [backendReadyError, setBackendReadyError] = useState("");
  const [sessionStatus, setSessionStatus] = useState<LocalSessionStatus | null>(
    null,
  );
  const [sessionForm, setSessionForm] = useState<SessionFormState>({
    token: "",
  });
  const [sessionError, setSessionError] = useState("");
  const [isEditingSession, setIsEditingSession] = useState(false);
  const [isSavingSession, setIsSavingSession] = useState(false);

  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
  const [issues, setIssues] = useState<DashboardIssue[]>([]);
  const [isFetchingSnapshot, setIsFetchingSnapshot] = useState(false);
  const [snapshotError, setSnapshotError] = useState("");
  const [syncError, setSyncError] = useState("");

  const issuesRef = useRef<DashboardIssue[]>([]);
  const dirtyIssueKeysRef = useRef<Set<string>>(new Set());
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeSyncRef = useRef<Promise<void> | null>(null);
  const flushDirtyIssueStatesRef = useRef<() => Promise<void>>(async () => {});
  const detailRequestsRef = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    issuesRef.current = issues;
  }, [issues]);

  const markDirtyKey = useCallback((issueKey: string) => {
    dirtyIssueKeysRef.current.add(issueKey);
  }, []);

  const clearDirtyKeys = useCallback((keysToClear: string[]) => {
    for (const key of keysToClear) {
      dirtyIssueKeysRef.current.delete(key);
    }
  }, []);

  const scheduleDirtyIssueSync = useCallback((delay = 600) => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(() => {
      syncTimeoutRef.current = null;
      void flushDirtyIssueStatesRef.current();
    }, delay);
  }, []);

  const updateIssueState = useCallback(
    (
      issueKey: string,
      updater: (previousState: IssueLocalState) => IssueLocalState,
    ) => {
      const interactedAt = new Date().toISOString();

      setIssues((previousIssues) => {
        const nextIssues = previousIssues.map((issue) => {
          if (issue.issueKey !== issueKey) {
            return issue;
          }

          const nextLocalState = {
            ...updater(issue.localState),
            lastInteractedAt: interactedAt,
          };

          return {
            ...issue,
            localState: nextLocalState,
          };
        });
        issuesRef.current = nextIssues;
        return nextIssues;
      });

      markDirtyKey(issueKey);
      scheduleDirtyIssueSync();
    },
    [markDirtyKey, scheduleDirtyIssueSync],
  );

  const fetchSnapshotData = useCallback(
    async (
      windowOption: ClosedWindowOption,
      options: { silent?: boolean } = {},
    ) => {
      if (!options.silent) {
        setIsFetchingSnapshot(true);
      }
      setSnapshotError("");

      try {
        const nextSnapshot = await getIssuesSnapshot(windowOption);
        setSnapshot(nextSnapshot);
        setIssues((currentIssues) => {
          const currentIssuesByKey = new Map(
            currentIssues.map((issue) => [issue.issueKey, issue]),
          );
          const nextIssues = nextSnapshot.issues.map((issue) => {
            const normalizedIssue = normalizeIssue(issue);
            const currentIssue = currentIssuesByKey.get(issue.issueKey);
            return currentIssue && dirtyIssueKeysRef.current.has(issue.issueKey)
              ? { ...normalizedIssue, localState: currentIssue.localState }
              : normalizedIssue;
          });
          issuesRef.current = nextIssues;
          return nextIssues;
        });
      } catch (error) {
        if (isAuthenticationApiError(error)) {
          setSessionStatus((previousStatus) => ({
            configured: false,
            username: previousStatus?.username ?? null,
          }));
          setIsEditingSession(false);
          setSessionError(
            "La sesión actual expiró o las credenciales no son válidas.",
          );
          return;
        }

        if (isConnectivityApiError(error)) {
          setSnapshotError(
            "No hay conexión con el servicio local. Revisa que la API esté activa.",
          );
          return;
        }

        setSnapshotError(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los datos de las issues.",
        );
      } finally {
        if (!options.silent) {
          setIsFetchingSnapshot(false);
        }
      }
    },
    [],
  );

  const loadIssueDetail = useCallback((issueKey: string) => {
    const currentIssue = issuesRef.current.find(
      (issue) => issue.issueKey === issueKey,
    );
    if (!currentIssue || currentIssue.detailsLoaded) return Promise.resolve();

    const pendingRequest = detailRequestsRef.current.get(issueKey);
    if (pendingRequest) return pendingRequest;

    const request = (async () => {
      try {
        const detail = normalizeIssue(await getIssueDetail(issueKey));
        setIssues((currentIssues) => {
          const nextIssues = currentIssues.map((issue) => {
            if (issue.issueKey !== issueKey) return issue;
            return {
              ...detail,
              localState: dirtyIssueKeysRef.current.has(issueKey)
                ? issue.localState
                : detail.localState,
            };
          });
          issuesRef.current = nextIssues;
          return nextIssues;
        });
      } catch (error) {
        setSnapshotError(
          error instanceof Error
            ? error.message
            : "No se pudo cargar el detalle local de la issue.",
        );
      } finally {
        detailRequestsRef.current.delete(issueKey);
      }
    })();
    detailRequestsRef.current.set(issueKey, request);
    return request;
  }, []);

  const flushDirtyIssueStates = useCallback(async () => {
    if (activeSyncRef.current) {
      await activeSyncRef.current;
      if (dirtyIssueKeysRef.current.size > 0) {
        scheduleDirtyIssueSync();
      }
      return;
    }

    const payload = buildSyncPayload(
      issuesRef.current,
      dirtyIssueKeysRef.current,
    );

    if (payload.length === 0) {
      return;
    }

    setSyncError("");

    const syncPromise = (async () => {
      let synchronized = false;
      try {
        await syncIssueStates(payload);
        synchronized = true;
        const stableKeys = getLatestStableKeys(payload, issuesRef.current);
        clearDirtyKeys(stableKeys);
      } catch (error) {
        if (isConnectivityApiError(error)) {
          setSyncError(
            "Hay cambios pendientes de guardar. Se reintentará al recuperar la conexión.",
          );
          return;
        }

        setSyncError(
          error instanceof Error
            ? error.message
            : "No se pudieron guardar los cambios locales.",
        );
      } finally {
        activeSyncRef.current = null;
        if (synchronized && dirtyIssueKeysRef.current.size > 0) {
          scheduleDirtyIssueSync();
        }
      }
    })();

    activeSyncRef.current = syncPromise;
    return syncPromise;
  }, [clearDirtyKeys, scheduleDirtyIssueSync]);

  useEffect(() => {
    flushDirtyIssueStatesRef.current = flushDirtyIssueStates;
  }, [flushDirtyIssueStates]);

  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initSession() {
      try {
        const status = await waitForLocalSessionStatus(5000);
        if (cancelled) return;
        setBackendReady(true);
        setSessionStatus(status);
      } catch {
        if (cancelled) return;
        setBackendReady(false);
        setBackendReadyError(
          "El servicio local del dashboard no responde. Verifica que la API en Python esté ejecutándose.",
        );
      }
    }

    void initSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!backendReady || !sessionStatus?.configured) return;
    void fetchSnapshotData(closedWindow);
  }, [
    backendReady,
    closedWindow,
    fetchSnapshotData,
    sessionStatus?.configured,
  ]);

  const handleSaveSession = async () => {
    setIsSavingSession(true);
    setSessionError("");

    try {
      const nextStatus = await saveLocalSession({
        token: sessionForm.token.trim(),
      });

      setSessionStatus(nextStatus);
      setIsEditingSession(false);
      setSessionForm((previous) => ({ ...previous, token: "" }));
      await fetchSnapshotData(closedWindow);
    } catch (error) {
      if (isAuthenticationApiError(error)) {
        setSessionError(
          "No se pudo validar la sesión de GitHub. Revisa el usuario y token ingresados.",
        );
        return;
      }

      setSessionError(
        error instanceof Error
          ? error.message
          : "No se pudieron guardar las credenciales.",
      );
    } finally {
      setIsSavingSession(false);
    }
  };

  const handleClearSession = async () => {
    try {
      const nextStatus = await clearLocalSession();
      dirtyIssueKeysRef.current.clear();
      detailRequestsRef.current.clear();
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
      setSessionStatus(nextStatus);
      setSnapshot(null);
      setIssues([]);
      setIsEditingSession(false);
      setSessionForm({ token: "" });
    } catch (error) {
      setSessionError(
        error instanceof Error
          ? error.message
          : "No se pudo cerrar la sesión local.",
      );
    }
  };

  const setPriority = useCallback(
    (issueKey: string, priority: PriorityValue | null) => {
      updateIssueState(issueKey, (previous) => ({
        ...previous,
        isPinned: priority === null ? false : previous.isPinned,
        priority,
      }));
    },
    [updateIssueState],
  );

  const togglePin = useCallback(
    (issueKey: string) => {
      updateIssueState(issueKey, (previous) => {
        if (previous.priority === null) {
          return previous;
        }
        return {
          ...previous,
          isPinned: !previous.isPinned,
        };
      });
    },
    [updateIssueState],
  );

  const completeIssue = useCallback(
    (issueKey: string) => {
      updateIssueState(issueKey, (previous) => ({
        ...previous,
        isPinned: false,
        lastPinnedBeforeCompletion: previous.isPinned,
        lastPriorityBeforeCompletion: previous.priority,
        localCompletedAt: new Date().toISOString(),
        priority: null,
        status: "completed",
      }));
    },
    [updateIssueState],
  );

  const reviewIssue = useCallback(
    (issueKey: string) => {
      updateIssueState(issueKey, (previous) => ({
        ...previous,
        isPinned: false,
        lastPinnedBeforeCompletion: previous.isPinned,
        lastPriorityBeforeCompletion: previous.priority,
        localCompletedAt: null,
        priority: null,
        status: "in_review",
      }));
    },
    [updateIssueState],
  );

  const restoreIssue = useCallback(
    (issueKey: string) => {
      updateIssueState(issueKey, (previous) => ({
        ...previous,
        isPinned: previous.lastPinnedBeforeCompletion ?? false,
        localCompletedAt: null,
        priority: previous.lastPriorityBeforeCompletion ?? null,
        status: "active",
      }));
    },
    [updateIssueState],
  );

  const updateNoteBlocks = useCallback(
    (
      issueKey: string,
      nextBlocks: DashboardIssue["localState"]["noteBlocks"],
    ) => {
      updateIssueState(issueKey, (previous) => ({
        ...previous,
        noteBlocks: nextBlocks,
      }));
    },
    [updateIssueState],
  );

  return {
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
    setFormValue: (field: keyof SessionFormState, value: string) =>
      setSessionForm((prev) => ({ ...prev, [field]: value })),
    setIsEditingSession,
    setPriority,
    snapshot,
    snapshotError,
    syncError,
    togglePin,
    updateNoteBlocks,
  };
}
