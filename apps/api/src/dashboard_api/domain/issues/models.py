"""Define the issue-tracking domain models."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

PriorityValue = Literal[1, 2, 3, 4]
NoteBlockKind = Literal["text", "checklist", "ordered"]
RemoteIssueState = Literal["open", "closed"]


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


@dataclass(frozen=True, slots=True)
class IssueLocalStateChange:
    """Represent a local state update emitted by the frontend."""

    issue_key: str
    github_id: int
    repository_full_name: str
    repository_name: str
    issue_number: int
    state: IssueLocalState
