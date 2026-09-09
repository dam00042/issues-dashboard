import type { DashboardIssue } from "@/features/issues-dashboard/types";
import { normalizeNoteBlocks } from "./dashboard-helpers";

export function reconcileIssue(
  incoming: DashboardIssue,
  current?: DashboardIssue,
  { dirty = false, dirtyNotes = false, replaceLocalState = false } = {},
): DashboardIssue {
  const normalized = {
    ...incoming,
    notesLoaded: incoming.notesLoaded ?? incoming.detailsLoaded,
    localState: {
      ...incoming.localState,
      noteBlocks: normalizeNoteBlocks(incoming.localState.noteBlocks),
    },
  };
  if (!current) return normalized;

  const sameLocalVersion =
    current.localState.lastInteractedAt ===
    incoming.localState.lastInteractedAt;
  const hasNewerLocalState =
    Date.parse(current.localState.lastInteractedAt ?? "") >
    Date.parse(incoming.localState.lastInteractedAt ?? "1970-01-01");
  const preserveLocalState =
    dirty || (!replaceLocalState && hasNewerLocalState);
  const preserveNotes =
    dirtyNotes ||
    (!replaceLocalState &&
      (current.notesLoaded ?? current.detailsLoaded) &&
      (preserveLocalState || (!incoming.detailsLoaded && sameLocalVersion)));
  const reuseDetails =
    !replaceLocalState &&
    !incoming.detailsLoaded &&
    current.detailsLoaded &&
    current.syncedAt === incoming.syncedAt &&
    (sameLocalVersion || preserveLocalState);

  return {
    ...normalized,
    notesLoaded: preserveNotes || normalized.notesLoaded,
    ...(reuseDetails
      ? {
          body: current.body,
          detailsLoaded: true,
          projectItems: current.projectItems,
        }
      : {}),
    localState: {
      ...(preserveLocalState ? current.localState : normalized.localState),
      noteBlocks: preserveNotes
        ? current.localState.noteBlocks
        : normalized.localState.noteBlocks,
    },
  };
}

export async function flushMissingIssueStates(
  incomingIssues: readonly DashboardIssue[],
  dirtyIssueVersions: ReadonlyMap<string, number>,
  flushDirtyStates: () => Promise<void>,
): Promise<void> {
  const incomingKeys = new Set(incomingIssues.map((issue) => issue.issueKey));
  if ([...dirtyIssueVersions.keys()].some((key) => !incomingKeys.has(key))) {
    // A filtered-out issue must be saved before its state leaves the view.
    await flushDirtyStates();
  }
}

export function getStableIssueKeys(
  submittedVersions: ReadonlyMap<string, number>,
  currentVersions: ReadonlyMap<string, number>,
): string[] {
  return [...submittedVersions].flatMap(([issueKey, version]) =>
    currentVersions.get(issueKey) === version ? [issueKey] : [],
  );
}
