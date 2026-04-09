"""Define FastAPI request and response schemas."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal, Self

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from dashboard_api.application.issues.service import (
    IssueLocalStateTarget,
)
from dashboard_api.domain.issues.models import (
    IssueLocalState,
    IssueLocalStateChange,
    NoteBlock,
    NoteBlockItem,
    TrackedIssue,
)

if TYPE_CHECKING:
    from dashboard_api.application.issues.service import (
        IssueDashboardSnapshot,
    )
    from dashboard_api.application.session.service import (
        GitHubSessionStatus,
    )


class CamelModel(BaseModel):
    """Provide camelCase aliases for HTTP payload models."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        populate_by_name=True,
    )


class NoteBlockItemPayload(CamelModel):
    """Represent one note block item in the HTTP API."""

    id: str
    kind: Literal["text", "checklist", "ordered"] = "text"
    text: str
    checked: bool = False

    @classmethod
    def from_domain(cls, item: NoteBlockItem) -> Self:
        """Build an item payload from a domain item."""
        return cls(
            id=item.id,
            kind=item.kind,
            text=item.text,
            checked=item.checked,
        )

    def to_domain(self) -> NoteBlockItem:
        """Build a domain item from the payload."""
        return NoteBlockItem(
            id=self.id,
            kind=self.kind,
            text=self.text,
            checked=self.checked,
        )


class NoteBlockPayload(CamelModel):
    """Represent one editable note block in the HTTP API."""

    id: str
    label: str
    items: list[NoteBlockItemPayload] = Field(default_factory=list)

    @classmethod
    def from_domain(cls, block: NoteBlock) -> Self:
        """Build a block payload from a domain block."""
        return cls(
            id=block.id,
            label=block.label,
            items=[NoteBlockItemPayload.from_domain(item) for item in block.items],
        )

    def to_domain(self) -> NoteBlock:
        """Build a domain block from the payload."""
        return NoteBlock(
            id=self.id,
            label=self.label,
            items=tuple(item.to_domain() for item in self.items),
        )


class IssueLocalStatePayload(CamelModel):
    """Represent local issue state in request and response payloads."""

    priority: Literal[1, 2, 3, 4] | None = None
    is_pinned: bool = False
    local_completed_at: str | None = None
    last_priority_before_completion: Literal[1, 2, 3, 4] | None = None
    last_pinned_before_completion: bool = False
    note_blocks: list[NoteBlockPayload] = Field(default_factory=list)
    last_interacted_at: str | None = None

    @classmethod
    def from_domain(cls, state: IssueLocalState) -> Self:
        """Build a local-state payload from a domain state."""
        return cls(
            priority=state.priority,
            is_pinned=state.is_pinned,
            local_completed_at=state.local_completed_at,
            last_priority_before_completion=state.last_priority_before_completion,
            last_pinned_before_completion=state.last_pinned_before_completion,
            note_blocks=[
                NoteBlockPayload.from_domain(note_block)
                for note_block in state.note_blocks
            ],
            last_interacted_at=state.last_interacted_at,
        )

    def to_domain(self) -> IssueLocalState:
        """Build a domain local state from the payload."""
        return IssueLocalState(
            priority=self.priority,
            is_pinned=self.is_pinned,
            local_completed_at=self.local_completed_at,
            last_priority_before_completion=self.last_priority_before_completion,
            last_pinned_before_completion=self.last_pinned_before_completion,
            note_blocks=tuple(
                note_block.to_domain() for note_block in self.note_blocks
            ),
            last_interacted_at=self.last_interacted_at,
        )


class RepositoryPayload(CamelModel):
    """Represent repository details for one issue."""

    name: str
    full_name: str
    owner_login: str
    owner_avatar_url: str

    @classmethod
    def from_domain(cls, issue: TrackedIssue) -> Self:
        """Build a repository payload from a tracked issue."""
        return cls(
            name=issue.repository_name,
            full_name=issue.repository_full_name,
            owner_login=issue.repository_owner_login,
            owner_avatar_url=issue.repository_owner_avatar_url,
        )


class IssuePayload(CamelModel):
    """Represent one tracked issue in the dashboard snapshot."""

    issue_key: str
    github_id: int
    repository: RepositoryPayload
    number: int
    remote_state: Literal["open", "closed"]
    title: str
    body: str
    html_url: str
    created_at: str | None = None
    updated_at: str | None = None
    closed_at: str | None = None
    local_state: IssueLocalStatePayload
    first_seen_at: str
    synced_at: str

    @classmethod
    def from_domain(cls, issue: TrackedIssue) -> Self:
        """Build an issue payload from a tracked issue."""
        return cls(
            issue_key=issue.issue_key,
            github_id=issue.github_id,
            repository=RepositoryPayload.from_domain(issue),
            number=issue.issue_number,
            remote_state=issue.remote_state,
            title=issue.title,
            body=issue.body_markdown,
            html_url=issue.html_url,
            created_at=issue.created_at,
            updated_at=issue.updated_at,
            closed_at=issue.closed_at,
            local_state=IssueLocalStatePayload.from_domain(issue.local_state),
            first_seen_at=issue.first_seen_at,
            synced_at=issue.synced_at,
        )


class SnapshotMetaPayload(CamelModel):
    """Represent snapshot metadata for the HTTP response."""

    source: Literal["live", "cache"]
    refreshed_at: str
    closed_window_months: int | None = None

    @classmethod
    def from_domain(cls, snapshot: IssueDashboardSnapshot) -> Self:
        """Build snapshot metadata from a domain snapshot."""
        return cls(
            source=snapshot.source,
            refreshed_at=snapshot.refreshed_at,
            closed_window_months=snapshot.closed_window_months,
        )


class SnapshotResponse(CamelModel):
    """Represent the dashboard snapshot response body."""

    issues: list[IssuePayload]
    meta: SnapshotMetaPayload

    @classmethod
    def from_domain(cls, snapshot: IssueDashboardSnapshot) -> Self:
        """Build a snapshot response from a domain snapshot."""
        return cls(
            issues=[IssuePayload.from_domain(issue) for issue in snapshot.issues],
            meta=SnapshotMetaPayload.from_domain(snapshot),
        )


class GitHubSessionPayload(CamelModel):
    """Represent the credentials payload used to persist a local session."""

    token: str = ""
    username: str


class GitHubSessionStatusPayload(CamelModel):
    """Represent whether a usable GitHub session is configured."""

    configured: bool
    username: str | None = None

    @classmethod
    def from_domain(cls, status: GitHubSessionStatus) -> Self:
        """Build a session status payload from the application service."""
        return cls(
            configured=status.configured,
            username=status.username,
        )


class IssueReferencePayload(CamelModel):
    """Identify one issue in local-state mutation requests."""

    issue_key: str
    github_id: int
    repo_full_name: str
    repo_name: str
    issue_number: int

    def to_target(self) -> IssueLocalStateTarget:
        """Build an application-level issue target from the payload."""
        return IssueLocalStateTarget(
            issue_key=self.issue_key,
            github_id=self.github_id,
            repository_full_name=self.repo_full_name,
            repository_name=self.repo_name,
            issue_number=self.issue_number,
        )


class SyncStateItemPayload(IssueReferencePayload):
    """Represent one local state change sent by the frontend."""

    state: IssueLocalStatePayload

    def to_domain(self) -> IssueLocalStateChange:
        """Build a domain local-state change from the payload."""
        return IssueLocalStateChange(
            issue_key=self.issue_key,
            github_id=self.github_id,
            repository_full_name=self.repo_full_name,
            repository_name=self.repo_name,
            issue_number=self.issue_number,
            state=self.state.to_domain(),
        )


class IssuePriorityUpdatePayload(IssueReferencePayload):
    """Represent one priority update request."""

    priority: Literal[1, 2, 3, 4] | None = None


class IssuePinUpdatePayload(IssueReferencePayload):
    """Represent one pin-state update request."""

    is_pinned: bool


class IssueCompletionUpdatePayload(IssueReferencePayload):
    """Represent one completion-state update request."""

    is_completed: bool
    state: IssueLocalStatePayload

    def to_domain(self) -> IssueLocalStateChange:
        """Build a domain local-state change from the payload."""
        return IssueLocalStateChange(
            issue_key=self.issue_key,
            github_id=self.github_id,
            repository_full_name=self.repo_full_name,
            repository_name=self.repo_name,
            issue_number=self.issue_number,
            state=self.state.to_domain(),
        )


class IssueNotesUpdatePayload(IssueReferencePayload):
    """Represent one notes update request."""

    note_blocks: list[NoteBlockPayload] = Field(default_factory=list)
    last_interacted_at: str | None = None

    def to_note_blocks(self) -> tuple[NoteBlock, ...]:
        """Build domain note blocks from the payload."""
        return tuple(note_block.to_domain() for note_block in self.note_blocks)


class SyncStatesPayload(CamelModel):
    """Represent the batched local-state sync request body."""

    states: list[SyncStateItemPayload]

    def to_domain(self) -> tuple[IssueLocalStateChange, ...]:
        """Build domain local-state changes from the payload."""
        return tuple(sync_state.to_domain() for sync_state in self.states)
