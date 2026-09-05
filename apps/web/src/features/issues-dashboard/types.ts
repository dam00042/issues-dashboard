import type { LucideIcon } from "lucide-react";

import type { ThemeMode } from "@/types/desktop";

export type PriorityValue = 1 | 2 | 3 | 4;
export type NoteBlockKind = "text" | "checklist" | "ordered";
export type RemoteIssueState = "open" | "closed";
export type RemoteIssueStateFilter = RemoteIssueState | "all";
export type ClosedWindowUnit = "d" | "m" | "y";
export type ClosedWindowOption = "all" | `${number}${ClosedWindowUnit}`;
export type DashboardSection = "board" | "completed" | "pull_requests";
export type LocalIssueStatus = "active" | "in_review" | "completed";
export type ProjectFieldKind =
  | "date"
  | "iteration"
  | "labels"
  | "milestone"
  | "multi_select"
  | "number"
  | "pull_requests"
  | "repository"
  | "reviewers"
  | "single_select"
  | "text"
  | "users";

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
  status?: LocalIssueStatus;
}

export interface RepositorySummary {
  fullName: string;
  name: string;
  ownerAvatarUrl: string;
  ownerLogin: string;
}

export interface GitHubProjectFieldValue {
  fieldId: string;
  fieldName: string;
  kind: ProjectFieldKind;
  value: string;
}

export interface GitHubProjectItem {
  fields: GitHubProjectFieldValue[];
  linkedPullRequests?: GitHubPullRequest[];
  projectId: string;
  projectNumber: number;
  projectTitle: string;
  projectUrl: string;
}

export type PullRequestState = "open" | "closed" | "merged";
export type PullRequestStateFilter =
  | PullRequestState
  | "all"
  | "draft"
  | "custom";
export type PullRequestWindowOption = `${number}${ClosedWindowUnit}`;
export type PullRequestViewerRole =
  | "authored"
  | "review_requested"
  | "reviewed";

export interface GitHubPullRequest {
  authorLogin: string;
  commentsCount: number;
  htmlUrl: string;
  isDraft: boolean;
  mergedAt: string | null;
  nodeId: string;
  number: number;
  repositoryFullName: string;
  reviewDecision: "approved" | "changes_requested" | "review_required" | null;
  reviewerLogins: string[];
  reviewRequestedFromViewer: boolean;
  state: PullRequestState;
  title: string;
  updatedAt: string | null;
  viewerReviewState: string | null;
  viewerRole: PullRequestViewerRole | null;
}

export interface PullRequestDashboardResponse {
  pullRequests: GitHubPullRequest[];
  refreshedAt: string | null;
  source: "live" | "cache";
  warning: string | null;
}

export interface ProjectFilterDefinition {
  key: string;
  label: string;
  options: string[];
}

export type SelectedProjectFields = Record<string, string>;

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
  projectItems: GitHubProjectItem[];
  remoteState: RemoteIssueState;
  repository: RepositorySummary;
  syncedAt: string;
  title: string;
  updatedAt: string | null;
}

export interface SnapshotMeta {
  closedWindowAmount: number | null;
  closedWindowMonths: number | null;
  closedWindowUnit: "days" | "months" | "years" | null;
  refreshedAt: string;
  source: "cache" | "live";
  projectFieldsWarning: string | null;
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
