"""Define the issue-tracking domain models."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

PriorityValue = Literal[1, 2, 3, 4]
IssueLocalStatus = Literal["active", "in_review", "completed"]
NoteBlockKind = Literal["text", "checklist", "ordered"]
RemoteIssueState = Literal["open", "closed"]
ProjectFieldKind = Literal[
    "date",
    "iteration",
    "labels",
    "milestone",
    "multi_select",
    "number",
    "pull_requests",
    "repository",
    "reviewers",
    "single_select",
    "text",
    "users",
]
PullRequestState = Literal["open", "closed", "merged"]
PullRequestViewerRole = Literal["authored", "review_requested", "reviewed"]
PullRequestReviewDecision = Literal[
    "approved",
    "changes_requested",
    "review_required",
]
ClosedIssueWindowUnit = Literal["days", "months", "years"]
PullRequestWindowUnit = Literal["days", "months", "years"]


@dataclass(frozen=True, slots=True)
class ClosedIssueWindow:
    """Represent how far back closed issues remain visible."""

    amount: int
    unit: ClosedIssueWindowUnit


@dataclass(frozen=True, slots=True)
class PullRequestWindow:
    """Represent how far back Pull Request activity is loaded."""

    amount: int
    unit: PullRequestWindowUnit


@dataclass(frozen=True, slots=True)
class GitHubPullRequest:
    """Represent the Pull Request data needed by the dashboard."""

    node_id: str
    repository_full_name: str
    number: int
    title: str
    html_url: str
    state: PullRequestState
    is_draft: bool
    author_login: str
    updated_at: str | None
    reviewer_logins: tuple[str, ...] = ()
    merged_at: str | None = None
    review_decision: PullRequestReviewDecision | None = None
    viewer_review_state: str | None = None
    review_requested_from_viewer: bool = False
    viewer_role: PullRequestViewerRole | None = None
    comments_count: int = 0


@dataclass(frozen=True, slots=True)
class GitHubProjectFieldValue:
    """Represent one populated field on a GitHub Projects item."""

    field_id: str
    field_name: str
    kind: ProjectFieldKind
    value: str


@dataclass(frozen=True, slots=True)
class GitHubProjectItem:
    """Represent the Projects item associated with a GitHub issue."""

    project_id: str
    project_number: int
    project_title: str
    project_url: str
    fields: tuple[GitHubProjectFieldValue, ...]
    linked_pull_requests: tuple[GitHubPullRequest, ...] = ()


@dataclass(frozen=True, slots=True)
class NoteBlockItem:
    """Represent one editable line inside a notes section."""

    id: str
    kind: NoteBlockKind
    text: str
    checked: bool = False


@dataclass(frozen=True, slots=True)
class NoteBlock:
    """Represent one fixed notes section for an issue."""

    id: str
    label: str
    items: tuple[NoteBlockItem, ...]


@dataclass(frozen=True, slots=True)
class IssueLocalState:
    """Represent the local user-owned state for an issue."""

    priority: PriorityValue | None
    is_pinned: bool
    local_completed_at: str | None
    last_priority_before_completion: PriorityValue | None
    last_pinned_before_completion: bool
    note_blocks: tuple[NoteBlock, ...]
    last_interacted_at: str | None
    status: IssueLocalStatus = "active"


@dataclass(frozen=True, slots=True)
class IssueLocalStateTarget:
    """Identify the issue whose local state should be mutated."""

    issue_key: str
    github_id: int
    repository_full_name: str
    repository_name: str
    issue_number: int


@dataclass(frozen=True, slots=True)
class TrackedIssue:
    """Represent a merged remote-plus-local issue projection."""

    issue_key: str
    github_id: int
    repository_full_name: str
    repository_name: str
    repository_owner_login: str
    repository_owner_avatar_url: str
    issue_number: int
    remote_state: RemoteIssueState
    title: str
    body_markdown: str
    html_url: str
    created_at: str | None
    updated_at: str | None
    closed_at: str | None
    is_assigned: bool
    local_state: IssueLocalState
    first_seen_at: str
    synced_at: str
    project_items: tuple[GitHubProjectItem, ...] = ()


@dataclass(frozen=True, slots=True)
class GitHubAssignedIssue:
    """Represent an issue fetched from the GitHub assigned issues feed."""

    github_id: int
    repository_full_name: str
    repository_name: str
    repository_owner_login: str
    repository_owner_avatar_url: str
    issue_number: int
    remote_state: RemoteIssueState
    title: str
    body_markdown: str
    html_url: str
    created_at: str | None
    updated_at: str | None
    closed_at: str | None
    project_items: tuple[GitHubProjectItem, ...] = ()


@dataclass(frozen=True, slots=True)
class IssueLocalStateChange:
    """Represent a local state update emitted by the frontend."""

    issue_key: str
    github_id: int
    repository_full_name: str
    repository_name: str
    issue_number: int
    state: IssueLocalState
    preserve_note_blocks: bool = False
