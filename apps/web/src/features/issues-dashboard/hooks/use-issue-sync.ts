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
} from "@/features/issues-dashboard/types";
import { buildSyncPayload } from "@/features/issues-dashboard/utils/dashboard-helpers";
import {
  flushMissingIssueStates,
  getStableIssueKeys,
  reconcileIssue,
} from "@/features/issues-dashboard/utils/issue-state";

export interface SessionFormState {
  token: string;
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
  const dirtyIssueVersionsRef = useRef(new Map<string, number>());
  const dirtyNoteKeysRef = useRef(new Set<string>());
  const editVersionRef = useRef(0);
  const snapshotRequestIdRef = useRef(0);
  const localStateGenerationRef = useRef(0);
  const restoredSnapshotPendingRef = useRef(false);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeSyncRef = useRef<Promise<void> | null>(null);
  const flushDirtyIssueStatesRef = useRef<() => Promise<void>>(async () => {});
  const detailRequestsRef = useRef(new Map<string, Promise<void>>());

  const replaceIssues = useCallback((nextIssues: DashboardIssue[]) => {
    issuesRef.current = nextIssues;
    setIssues(nextIssues);
  }, []);

  const clearDirtyKeys = useCallback((keysToClear: string[]) => {
    for (const key of keysToClear) {
      dirtyIssueVersionsRef.current.delete(key);
      dirtyNoteKeysRef.current.delete(key);
    }
  }, []);

  const resetPendingState = useCallback(() => {
    localStateGenerationRef.current += 1;
    snapshotRequestIdRef.current += 1;
    dirtyIssueVersionsRef.current.clear();
    dirtyNoteKeysRef.current.clear();
    detailRequestsRef.current.clear();
    activeSyncRef.current = null;
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    setSyncError("");
  }, []);

  const scheduleDirtyIssueSync = useCallback((delay = 600) => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(() => {
      syncTimeoutRef.current = null;
      void flushDirtyIssueStatesRef.current().catch(() => {
        // The flush records the error and keeps pending edits for retry.
      });
    }, delay);
  }, []);

  const updateIssueState = useCallback(
    (
      issueKey: string,
      updater: (previousState: IssueLocalState) => IssueLocalState,
      { notesChanged = false } = {},
    ) => {
      const interactedAt = new Date().toISOString();
      let changed = false;
      const nextIssues = issuesRef.current.map((issue) => {
        if (issue.issueKey !== issueKey) {
          return issue;
        }
        const updatedState = updater(issue.localState);
        if (updatedState === issue.localState) return issue;
        changed = true;
        const nextLocalState = {
          ...updatedState,
          lastInteractedAt: interactedAt,
        };

        return {
          ...issue,
          notesLoaded:
            notesChanged || (issue.notesLoaded ?? issue.detailsLoaded),
          localState: nextLocalState,
        };
      });
      if (!changed) return;
      editVersionRef.current += 1;
      dirtyIssueVersionsRef.current.set(issueKey, editVersionRef.current);
      if (notesChanged) dirtyNoteKeysRef.current.add(issueKey);
      replaceIssues(nextIssues);
      scheduleDirtyIssueSync();
    },
    [replaceIssues, scheduleDirtyIssueSync],
  );

  const fetchSnapshotData = useCallback(
    async (
      windowOption: ClosedWindowOption,
      options: { silent?: boolean; replaceLocalState?: boolean } = {},
    ) => {
      if (options.replaceLocalState) {
        resetPendingState();
        restoredSnapshotPendingRef.current = true;
      }
      const requestId = ++snapshotRequestIdRef.current;
      if (!options.silent) {
        setIsFetchingSnapshot(true);
      }
      setSnapshotError("");

      try {
        const nextSnapshot = await getIssuesSnapshot(windowOption);
        if (requestId !== snapshotRequestIdRef.current) return;
        await flushMissingIssueStates(
          nextSnapshot.issues,
          dirtyIssueVersionsRef.current,
          flushDirtyIssueStatesRef.current,
        );
        if (requestId !== snapshotRequestIdRef.current) return;
        setSnapshot(nextSnapshot);
        const currentIssuesByKey = new Map(
          issuesRef.current.map((issue) => [issue.issueKey, issue]),
        );
        const nextIssues = nextSnapshot.issues.map((issue) => {
          const currentIssue = currentIssuesByKey.get(issue.issueKey);
          return reconcileIssue(issue, currentIssue, {
            dirty: dirtyIssueVersionsRef.current.has(issue.issueKey),
            dirtyNotes: dirtyNoteKeysRef.current.has(issue.issueKey),
            replaceLocalState: restoredSnapshotPendingRef.current,
          });
        });
        restoredSnapshotPendingRef.current = false;
        replaceIssues(nextIssues);
      } catch (error) {
        if (requestId !== snapshotRequestIdRef.current) return;
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
        if (requestId === snapshotRequestIdRef.current) {
          setIsFetchingSnapshot(false);
        }
      }
    },
    [replaceIssues, resetPendingState],
  );

  const loadIssueDetail = useCallback(
    (issueKey: string) => {
      const currentIssue = issuesRef.current.find(
        (issue) => issue.issueKey === issueKey,
      );
      if (!currentIssue || currentIssue.detailsLoaded) return Promise.resolve();

      const pendingRequest = detailRequestsRef.current.get(issueKey);
      if (pendingRequest) return pendingRequest;
      const stateGeneration = localStateGenerationRef.current;

      const request = (async () => {
        try {
          const detail = await getIssueDetail(issueKey);
          if (stateGeneration !== localStateGenerationRef.current) return;
          const nextIssues = issuesRef.current.map((issue) => {
            if (issue.issueKey !== issueKey) return issue;
            return reconcileIssue(detail, issue, {
              dirty: dirtyIssueVersionsRef.current.has(issueKey),
              dirtyNotes: dirtyNoteKeysRef.current.has(issueKey),
            });
          });
          replaceIssues(nextIssues);
        } catch (error) {
          if (stateGeneration !== localStateGenerationRef.current) return;
          setSnapshotError(
            error instanceof Error
              ? error.message
              : "No se pudo cargar el detalle local de la issue.",
          );
        } finally {
          if (stateGeneration === localStateGenerationRef.current) {
            detailRequestsRef.current.delete(issueKey);
          }
        }
      })();
      detailRequestsRef.current.set(issueKey, request);
      return request;
    },
    [replaceIssues],
  );

  const flushDirtyIssueStates = useCallback(async () => {
    if (activeSyncRef.current) {
      return activeSyncRef.current;
    }
    if (dirtyIssueVersionsRef.current.size === 0) return;

    setSyncError("");
    const stateGeneration = localStateGenerationRef.current;

    const syncPromise = Promise.resolve().then(async () => {
      try {
        if (stateGeneration !== localStateGenerationRef.current) return;
        while (dirtyIssueVersionsRef.current.size > 0) {
          const submittedVersions = new Map(dirtyIssueVersionsRef.current);
          const payload = buildSyncPayload(
            issuesRef.current,
            submittedVersions.keys(),
            dirtyNoteKeysRef.current,
          );
          if (payload.length === 0) break;
          await syncIssueStates(payload);
          if (stateGeneration !== localStateGenerationRef.current) return;
          clearDirtyKeys(
            getStableIssueKeys(
              submittedVersions,
              dirtyIssueVersionsRef.current,
            ),
          );
        }
      } catch (error) {
        if (stateGeneration !== localStateGenerationRef.current) return;
        setSyncError(
          isConnectivityApiError(error)
            ? "Hay cambios pendientes de guardar. Se reintentará al recuperar la conexión."
            : error instanceof Error
              ? error.message
              : "No se pudieron guardar los cambios locales.",
        );
        throw error;
      } finally {
        if (stateGeneration === localStateGenerationRef.current) {
          activeSyncRef.current = null;
        }
      }
    });

    activeSyncRef.current = syncPromise;
    return syncPromise;
  }, [clearDirtyKeys]);

  useEffect(() => {
    flushDirtyIssueStatesRef.current = flushDirtyIssueStates;
  }, [flushDirtyIssueStates]);

  useEffect(() => {
    const retryPendingChanges = () => scheduleDirtyIssueSync(0);
    window.addEventListener("online", retryPendingChanges);
    return () => {
      window.removeEventListener("online", retryPendingChanges);
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [scheduleDirtyIssueSync]);

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
      resetPendingState();
      restoredSnapshotPendingRef.current = false;
      setSessionStatus(nextStatus);
      setSnapshot(null);
      replaceIssues([]);
      setIsFetchingSnapshot(false);
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
      updateIssueState(
        issueKey,
        (previous) => ({ ...previous, noteBlocks: nextBlocks }),
        { notesChanged: true },
      );
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
