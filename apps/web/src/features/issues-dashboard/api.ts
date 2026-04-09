import type {
  ClosedWindowOption,
  LocalSessionPayload,
  LocalSessionStatus,
  SnapshotResponse,
  SyncStateItem,
} from "@/features/issues-dashboard/types";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const CONNECTIVITY_ERROR_PATTERNS = [
  "failed to fetch",
  "fetch failed",
  "network error",
  "networkerror",
  "network request failed",
  "load failed",
  "econnrefused",
  "enotfound",
  "timed out",
  "timeout",
  "offline",
  "no se pudo conectar",
  "sin conexión",
  "connection refused",
  "could not connect",
];

function getApiBaseUrl(): string {
  if (typeof window !== "undefined" && window.githubIssuesDesktop?.apiBaseUrl) {
    return window.githubIssuesDesktop.apiBaseUrl;
  }

  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8010";
}

async function parseResponse<T>(response: Response): Promise<T> {
  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      ("detail" in payload || "message" in payload)
        ? ((payload as { detail?: string; message?: string }).detail ??
          (payload as { detail?: string; message?: string }).message ??
          "No se pudo completar la petición.")
        : "No se pudo completar la petición.";

    throw new ApiError(message, response.status);
  }

  return payload as T;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function isAuthenticationApiError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError && (error.status === 401 || error.status === 403)
  );
}

export function isConnectivityApiError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const normalizedMessage = error.message.toLowerCase();
  const hasConnectivityPattern = CONNECTIVITY_ERROR_PATTERNS.some((pattern) =>
    normalizedMessage.includes(pattern),
  );

  if (error instanceof ApiError) {
    return error.status >= 500 && hasConnectivityPattern;
  }

  return hasConnectivityPattern;
}

export async function getIssuesSnapshot(
  closedWindow: ClosedWindowOption,
): Promise<SnapshotResponse> {
  const url = new URL(`${getApiBaseUrl()}/api/issues/snapshot`);
  url.searchParams.set("closed_window", closedWindow);

  const response = await fetch(url, {
    cache: "no-store",
  });

  return parseResponse<SnapshotResponse>(response);
}

export async function getLocalSessionStatus(): Promise<LocalSessionStatus> {
  const response = await fetch(`${getApiBaseUrl()}/api/session/status`, {
    cache: "no-store",
  });

  return parseResponse<LocalSessionStatus>(response);
}

export async function waitForLocalSessionStatus(
  timeoutMs = 20_000,
): Promise<LocalSessionStatus> {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    try {
      return await getLocalSessionStatus();
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error("No se pudo conectar con el backend local.");
      await wait(250);
    }
  }

  throw lastError ?? new Error("No se pudo conectar con el backend local.");
}

export async function saveLocalSession(
  payload: LocalSessionPayload,
): Promise<LocalSessionStatus> {
  const response = await fetch(`${getApiBaseUrl()}/api/session`, {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return parseResponse<LocalSessionStatus>(response);
}

export async function clearLocalSession(): Promise<LocalSessionStatus> {
  const response = await fetch(`${getApiBaseUrl()}/api/session`, {
    method: "DELETE",
  });

  return parseResponse<LocalSessionStatus>(response);
}

function buildIssueReferencePayload(state: SyncStateItem) {
  return {
    githubId: state.githubId,
    issueKey: state.issueKey,
    issueNumber: state.issueNumber,
    repoFullName: state.repoFullName,
    repoName: state.repoName,
  };
}

export async function updateIssuePriority(
  state: SyncStateItem,
): Promise<number> {
  const response = await fetch(`${getApiBaseUrl()}/api/issues/priority`, {
    body: JSON.stringify({
      ...buildIssueReferencePayload(state),
      priority: state.state.priority,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });

  const payload = await parseResponse<{ updated: number }>(response);
  return payload.updated;
}

export async function updateIssuePinState(
  state: SyncStateItem,
): Promise<number> {
  const response = await fetch(`${getApiBaseUrl()}/api/issues/pin`, {
    body: JSON.stringify({
      ...buildIssueReferencePayload(state),
      isPinned: state.state.isPinned,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });

  const payload = await parseResponse<{ updated: number }>(response);
  return payload.updated;
}

export async function updateIssueCompletionState(
  state: SyncStateItem,
): Promise<number> {
  const response = await fetch(`${getApiBaseUrl()}/api/issues/completion`, {
    body: JSON.stringify({
      ...buildIssueReferencePayload(state),
      isCompleted: state.state.localCompletedAt !== null,
      state: state.state,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  });

  const payload = await parseResponse<{ updated: number }>(response);
  return payload.updated;
}

export async function updateIssueNotes(state: SyncStateItem): Promise<number> {
  const response = await fetch(`${getApiBaseUrl()}/api/issues/notes`, {
    body: JSON.stringify({
      ...buildIssueReferencePayload(state),
      lastInteractedAt: state.state.lastInteractedAt,
      noteBlocks: state.state.noteBlocks,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  });

  const payload = await parseResponse<{ updated: number }>(response);
  return payload.updated;
}

export async function syncIssueStates(
  states: SyncStateItem[],
): Promise<number> {
  const response = await fetch(`${getApiBaseUrl()}/api/issues/sync-state`, {
    body: JSON.stringify({ states }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const payload = await parseResponse<{ updated: number }>(response);
  return payload.updated;
}
