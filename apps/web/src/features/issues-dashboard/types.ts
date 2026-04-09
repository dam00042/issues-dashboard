import type { LucideIcon } from "lucide-react";

import type { ThemeMode } from "@/types/desktop";

export type PriorityValue = 1 | 2 | 3 | 4;
export type NoteBlockKind = "text" | "checklist" | "ordered";
export type RemoteIssueState = "open" | "closed";
export type ClosedWindowOption = "all" | `${number}`;
export type DashboardSection = "board" | "completed";

export interface NoteBlockItem {
  checked: boolean;
  id: string;
  kind: NoteBlockKind;
  text: string;
}

export interface NoteBlock {
  id: string;
  items: NoteBlockItem[];
  label: string;
}

export interface IssueLocalState {
  isPinned: boolean;
  lastInteractedAt: string | null;
  lastPinnedBeforeCompletion: boolean;
  lastPriorityBeforeCompletion: PriorityValue | null;
  localCompletedAt: string | null;
  noteBlocks: NoteBlock[];
  priority: PriorityValue | null;
}

export interface RepositorySummary {
  fullName: string;
  name: string;
  ownerAvatarUrl: string;
  ownerLogin: string;
}

export interface DashboardIssue {
  body: string;
  closedAt: string | null;
  createdAt: string | null;
  firstSeenAt: string;
  githubId: number;
  htmlUrl: string;
  issueKey: string;
  localState: IssueLocalState;
  number: number;
  remoteState: RemoteIssueState;
  repository: RepositorySummary;
  syncedAt: string;
  title: string;
  updatedAt: string | null;
}

export interface SnapshotMeta {
  closedWindowMonths: number | null;
  refreshedAt: string;
  source: "cache" | "live";
}

export interface SnapshotResponse {
  issues: DashboardIssue[];
  meta: SnapshotMeta;
}

export interface LocalSessionStatus {
  configured: boolean;
  username: string | null;
}

export interface LocalSessionPayload {
  token?: string;
  username: string;
}

export interface SyncStateItem {
  githubId: number;
  issueKey: string;
  issueNumber: number;
  repoFullName: string;
  repoName: string;
  state: IssueLocalState;
}

export interface PriorityDefinition {
  accentClassName: string;
  buttonClassName: string;
  color: string;
  headerClassName: string;
  icon: LucideIcon;
  label: string;
  tint: string;
  tooltipClassName: string;
  value: PriorityValue;
}

export interface ThemeDefinition {
  label: string;
  value: ThemeMode;
}
