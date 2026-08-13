"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearLocalSession,
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
  username: string;
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

export function useIssueSync(closedWindow: ClosedWindowOption) {
  const [backendReady, setBackendReady] = useState(false);
  const [backendReadyError, setBackendReadyError] = useState("");
  const [sessionStatus, setSessionStatus] = useState<LocalSessionStatus | null>(
    null,
  );
  const [sessionForm, setSessionForm] = useState<SessionFormState>({
    token: "",
    username: "",
  });
  const [sessionError, setSessionError] = useState("");
  const [isEditingSession, setIsEditingSession] = useState(false);
  const [isSavingSession, setIsSavingSession] = useState(false);

  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
  const [issues, setIssues] = useState<DashboardIssue[]>([]);
  const [dirtyIssueKeys, setDirtyIssueKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [isFetchingSnapshot, setIsFetchingSnapshot] = useState(false);
  const [isSyncingState, setIsSyncingState] = useState(false);
  const [snapshotError, setSnapshotError] = useState("");
  const [syncError, setSyncError] = useState("");

  const issuesRef = useRef<DashboardIssue[]>([]);
  const dirtyIssueKeysRef = useRef<Set<string>>(new Set());
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeSyncRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    issuesRef.current = issues;
  }, [issues]);

  useEffect(() => {
    dirtyIssueKeysRef.current = dirtyIssueKeys;
  }, [dirtyIssueKeys]);

  const markDirtyKey = useCallback((issueKey: string) => {
    setDirtyIssueKeys((previous) => {
      const next = new Set(previous);
      next.add(issueKey);
      return next;
    });
  }, []);

  const clearDirtyKeys = useCallback((keysToClear: string[]) => {
    if (keysToClear.length === 0) {
      return;
    }

    setDirtyIssueKeys((previous) => {
      const next = new Set(previous);
      for (const key of keysToClear) {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const updateIssueState = useCallback(
    (
      issueKey: string,
      updater: (previousState: IssueLocalState) => IssueLocalState,
      options: { flush?: boolean; trackDirty?: boolean } = {},
    ) => {
      const { trackDirty = true } = options;
      const interactedAt = new Date().toISOString();

      setIssues((previousIssues) =>
        previousIssues.map((issue) => {
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
        }),
      );

      if (trackDirty) {
        markDirtyKey(issueKey);
      }
    },
    [markDirtyKey],
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
        setIssues(nextSnapshot.issues.map(normalizeIssue));
      } catch (error) {
        if (isAuthenticationApiError(error)) {
          setSessionStatus({
            configured: false,
            username: sessionForm.username,
          });
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
    [sessionForm.username],
  );

  const flushDirtyIssueStates = useCallback(async () => {
    if (activeSyncRef.current) {
      return activeSyncRef.current;
    }

    const payload = buildSyncPayload(
      issuesRef.current,
      dirtyIssueKeysRef.current,
    );

    if (payload.length === 0) {
      return;
    }

    setIsSyncingState(true);
    setSyncError("");

    const syncPromise = (async () => {
      try {
        await syncIssueStates(payload);
        const stableKeys = getLatestStableKeys(payload, issuesRef.current);
        clearDirtyKeys(stableKeys);
      } catch (error) {
        if (isConnectivityApiError(error)) {
          setSyncError(
            "Cambios guardados localmente. Se sincronizarán al reconectar.",
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
        setIsSyncingState(false);
      }
    })();

    activeSyncRef.current = syncPromise;
    return syncPromise;
  }, [clearDirtyKeys]);

  useEffect(() => {
    if (dirtyIssueKeys.size === 0) {
      return;
    }

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(() => {
      void flushDirtyIssueStates();
    }, 600);

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [dirtyIssueKeys, flushDirtyIssueStates]);

  useEffect(() => {
    let cancelled = false;

    async function initSession() {
      try {
        const status = await waitForLocalSessionStatus(5000);
        if (cancelled) return;
        setBackendReady(true);
        setSessionStatus(status);
        setSessionForm((previous) => ({
          ...previous,
          username: status.username ?? "",
        }));

        if (status.configured) {
          void fetchSnapshotData(closedWindow);
        }
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
  }, [closedWindow, fetchSnapshotData]);

  const handleSaveSession = async () => {
    setIsSavingSession(true);
    setSessionError("");

    try {
      const nextStatus = await saveLocalSession({
        token: sessionForm.token.trim(),
        username: sessionForm.username.trim(),
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
      setSessionStatus(nextStatus);
      setSnapshot(null);
      setIssues([]);
      setIsEditingSession(false);
      setSessionForm({ token: "", username: "" });
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
    dirtyIssueKeys,
    fetchSnapshotData,
    flushDirtyIssueStates,
    handleClearSession,
    handleSaveSession,
    isEditingSession,
    isFetchingSnapshot,
    isSavingSession,
    isSyncingState,
    issues,
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
