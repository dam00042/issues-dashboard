"""Define FastAPI request and response schemas."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal, Self

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from dashboard_api.application.issues.service import (
    IssueLocalStateTarget,
)
from dashboard_api.domain.issues.models import (
    GitHubProjectFieldValue,
    GitHubProjectItem,
    GitHubPullRequest,
    IssueLocalState,
    IssueLocalStateChange,
    NoteBlock,
    NoteBlockItem,
    ProjectFieldKind,
    TrackedIssue,
)
from dashboard_api.domain.preferences.models import (
    AutoRefreshPreferences,
    DashboardPreferences,
    HistoryWindowPreferences,
    SidebarPreferences,
)

if TYPE_CHECKING:
    from dashboard_api.application.issues.service import (
        IssueDashboardSnapshot,
        PullRequestDashboard,
    )
    from dashboard_api.application.session.service import (
        GitHubSessionStatus,
    )
    from dashboard_api.application.synchronization.service import (
        SynchronizationResult,
        SynchronizationStatus,
    )


class CamelModel(BaseModel):
    """Provide camelCase aliases for HTTP payload models."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        populate_by_name=True,
    )


class HistoryWindowPreferencesPayload(CamelModel):
    """Represent one configurable local history window."""

    amount: int = Field(ge=1)
    unit: Literal["days", "months", "years"]
    unlimited: bool = False

    @classmethod
    def from_domain(cls, value: HistoryWindowPreferences) -> Self:
        """Build a payload from domain preferences."""
        return cls(
            amount=value.amount,
            unit=value.unit,
            unlimited=value.unlimited,
        )

    def to_domain(self) -> HistoryWindowPreferences:
        """Build domain preferences from the payload."""
        return HistoryWindowPreferences(
            amount=self.amount,
            unit=self.unit,
            unlimited=self.unlimited,
        )


class AutoRefreshPreferencesPayload(CamelModel):
    """Represent the optional automatic refresh interval."""

    enabled: bool = False
    amount: int = Field(default=5, ge=1)
    unit: Literal["minutes", "hours", "days"] = "minutes"

    @classmethod
    def from_domain(cls, value: AutoRefreshPreferences) -> Self:
        """Build a payload from domain preferences."""
        return cls(enabled=value.enabled, amount=value.amount, unit=value.unit)

    def to_domain(self) -> AutoRefreshPreferences:
        """Build domain preferences from the payload."""
        return AutoRefreshPreferences(
            enabled=self.enabled,
            amount=self.amount,
            unit=self.unit,
        )


class SidebarPreferencesPayload(CamelModel):
    """Represent portable sidebar preferences."""

    width: int = Field(default=460, ge=320, le=960)
    collapsed: bool = False

    @classmethod
    def from_domain(cls, value: SidebarPreferences) -> Self:
        """Build a payload from domain preferences."""
        return cls(width=value.width, collapsed=value.collapsed)

    def to_domain(self) -> SidebarPreferences:
        """Build domain preferences from the payload."""
        return SidebarPreferences(width=self.width, collapsed=self.collapsed)


class DashboardPreferencesPayload(CamelModel):
    """Represent every portable application preference."""

    version: int = 1
    theme: Literal["light", "dark", "system"] = "system"
    zoom_factor: float = Field(default=1.0, ge=0.75, le=1.6)
    closed_issue_history: HistoryWindowPreferencesPayload = Field(
        default_factory=lambda: HistoryWindowPreferencesPayload(
            amount=1,
            unit="months",
        ),
    )
    pull_request_history: HistoryWindowPreferencesPayload = Field(
        default_factory=lambda: HistoryWindowPreferencesPayload(
            amount=1,
            unit="months",
        ),
    )
    auto_refresh: AutoRefreshPreferencesPayload = Field(
        default_factory=AutoRefreshPreferencesPayload,
    )
    sidebar: SidebarPreferencesPayload = Field(
        default_factory=SidebarPreferencesPayload,
    )
    linked_pull_requests_collapsed: bool = True

    @classmethod
    def from_domain(cls, value: DashboardPreferences) -> Self:
        """Build an HTTP payload from domain preferences."""
        return cls(
            version=value.version,
            theme=value.theme,
            zoom_factor=value.zoom_factor,
            closed_issue_history=HistoryWindowPreferencesPayload.from_domain(
                value.closed_issue_history,
            ),
            pull_request_history=HistoryWindowPreferencesPayload.from_domain(
                value.pull_request_history,
            ),
            auto_refresh=AutoRefreshPreferencesPayload.from_domain(
                value.auto_refresh,
            ),
            sidebar=SidebarPreferencesPayload.from_domain(value.sidebar),
            linked_pull_requests_collapsed=(value.linked_pull_requests_collapsed),
        )

    def to_domain(self) -> DashboardPreferences:
        """Build domain preferences from the HTTP payload."""
        return DashboardPreferences(
            version=self.version,
            theme=self.theme,
            zoom_factor=self.zoom_factor,
            closed_issue_history=self.closed_issue_history.to_domain(),
            pull_request_history=self.pull_request_history.to_domain(),
            auto_refresh=self.auto_refresh.to_domain(),
            sidebar=self.sidebar.to_domain(),
            linked_pull_requests_collapsed=(self.linked_pull_requests_collapsed),
        )


class BackupPathPayload(CamelModel):
    """Represent a desktop-selected backup filesystem path."""

    path: str = Field(min_length=1)


class BackupExportResponse(CamelModel):
    """Describe a successfully created complete backup."""

    path: str


class BackupInspectionResponse(CamelModel):
    """Expose safe manifest metadata before restoring a backup."""

    source_account: str | None = None
    created_at: str
    schema_version: int


class BackupImportResponse(CamelModel):
    """Describe a successfully restored complete backup."""

    path: str
    source_account: str | None = None
    created_at: str
    schema_version: int
    safety_backup_path: str


class SynchronizationRequest(CamelModel):
    """Represent the configured windows for one unified GitHub refresh."""

    closed_window: str = "1m"
    pull_request_window: str = "1m"


class SynchronizationStatusPayload(CamelModel):
    """Represent observable unified synchronization state."""

    state: Literal["idle", "running", "succeeded", "partial"]
    started_at: str | None = None
    finished_at: str | None = None
    issues_refreshed_at: str | None = None
    pull_requests_refreshed_at: str | None = None
    warnings: list[str] = Field(default_factory=list)

    @classmethod
    def from_domain(cls, value: SynchronizationStatus) -> Self:
        """Build a response payload from synchronization state."""
        return cls(
            state=value.state,
            started_at=value.started_at,
            finished_at=value.finished_at,
            issues_refreshed_at=value.issues_refreshed_at,
            pull_requests_refreshed_at=value.pull_requests_refreshed_at,
            warnings=list(value.warnings),
        )


class SynchronizationResponse(CamelModel):
    """Describe whether a synchronization request started."""

    started: bool
    status: SynchronizationStatusPayload

    @classmethod
    def from_domain(cls, value: SynchronizationResult) -> Self:
        """Build a response payload from a synchronization result."""
        return cls(
            started=value.started,
            status=SynchronizationStatusPayload.from_domain(value.status),
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


class ProjectFieldValuePayload(CamelModel):
    """Represent one populated GitHub Projects field."""

    field_id: str
    field_name: str
    kind: ProjectFieldKind
    value: str

    @classmethod
    def from_domain(cls, field: GitHubProjectFieldValue) -> Self:
        """Build a project field payload from a domain value."""
        return cls(
            field_id=field.field_id,
            field_name=field.field_name,
            kind=field.kind,
            value=field.value,
        )


class PullRequestPayload(CamelModel):
    """Represent the Pull Request information displayed by the dashboard."""

    node_id: str
    repository_full_name: str
    number: int
    title: str
    html_url: str
    state: Literal["open", "closed", "merged"]
    is_draft: bool
    author_login: str
    reviewer_logins: list[str] = Field(default_factory=list)
    updated_at: str | None = None
    merged_at: str | None = None
    review_decision: (
        Literal[
            "approved",
            "changes_requested",
            "review_required",
        ]
        | None
    ) = None
    viewer_review_state: str | None = None
    review_requested_from_viewer: bool = False
    viewer_role: Literal["authored", "review_requested", "reviewed"] | None = None
    comments_count: int = 0

    @classmethod
    def from_domain(cls, pull_request: GitHubPullRequest) -> Self:
        """Build a Pull Request payload from its domain representation."""
        return cls(
            node_id=pull_request.node_id,
            repository_full_name=pull_request.repository_full_name,
            number=pull_request.number,
            title=pull_request.title,
            html_url=pull_request.html_url,
            state=pull_request.state,
            is_draft=pull_request.is_draft,
            author_login=pull_request.author_login,
            reviewer_logins=list(pull_request.reviewer_logins),
            updated_at=pull_request.updated_at,
            merged_at=pull_request.merged_at,
            review_decision=pull_request.review_decision,
            viewer_review_state=pull_request.viewer_review_state,
            review_requested_from_viewer=(pull_request.review_requested_from_viewer),
            viewer_role=pull_request.viewer_role,
            comments_count=pull_request.comments_count,
        )


class ProjectItemPayload(CamelModel):
    """Represent the GitHub Project containing an issue."""

    project_id: str
    project_number: int
    project_title: str
    project_url: str
    fields: list[ProjectFieldValuePayload]
    linked_pull_requests: list[PullRequestPayload]

    @classmethod
    def from_domain(cls, project_item: GitHubProjectItem) -> Self:
        """Build a project item payload from a domain item."""
        return cls(
            project_id=project_item.project_id,
            project_number=project_item.project_number,
            project_title=project_item.project_title,
            project_url=project_item.project_url,
            fields=[
                ProjectFieldValuePayload.from_domain(field)
                for field in project_item.fields
            ],
            linked_pull_requests=[
                PullRequestPayload.from_domain(pull_request)
                for pull_request in project_item.linked_pull_requests
            ],
        )

    @classmethod
    def summary_from_domain(cls, project_item: GitHubProjectItem) -> Self:
        """Build filter metadata without repeating linked PR details."""
        return cls(
            project_id=project_item.project_id,
            project_number=project_item.project_number,
            project_title=project_item.project_title,
            project_url=project_item.project_url,
            fields=[
                ProjectFieldValuePayload.from_domain(field)
                for field in project_item.fields
            ],
            linked_pull_requests=[],
        )


class PullRequestDashboardResponse(CamelModel):
    """Represent the on-demand Pull Request dashboard response."""

    pull_requests: list[PullRequestPayload]
    warning: str | None = None
    source: Literal["live", "cache"] = "cache"
    refreshed_at: str | None = None

    @classmethod
    def from_domain(cls, dashboard: PullRequestDashboard) -> Self:
        """Build an HTTP response from the Pull Request dashboard."""
        return cls(
            pull_requests=[
                PullRequestPayload.from_domain(pull_request)
                for pull_request in dashboard.pull_requests
            ],
            warning=dashboard.warning,
            source=dashboard.source,
            refreshed_at=dashboard.refreshed_at,
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
    project_items: list[ProjectItemPayload]
    details_loaded: bool = True

    @classmethod
    def from_domain(
        cls,
        issue: TrackedIssue,
        *,
        compact: bool = False,
    ) -> Self:
        """Build an issue payload from a tracked issue."""
        return cls(
            issue_key=issue.issue_key,
            github_id=issue.github_id,
            repository=RepositoryPayload.from_domain(issue),
            number=issue.issue_number,
            remote_state=issue.remote_state,
            title=issue.title,
            body="" if compact else issue.body_markdown,
            html_url=issue.html_url,
            created_at=issue.created_at,
            updated_at=issue.updated_at,
            closed_at=issue.closed_at,
            local_state=(
                IssueLocalStatePayload.from_domain(issue.local_state)
                if not compact
                else IssueLocalStatePayload(
                    priority=issue.local_state.priority,
                    is_pinned=issue.local_state.is_pinned,
                    local_completed_at=issue.local_state.local_completed_at,
                    last_priority_before_completion=(
                        issue.local_state.last_priority_before_completion
                    ),
                    last_pinned_before_completion=(
                        issue.local_state.last_pinned_before_completion
                    ),
                    note_blocks=[],
                    last_interacted_at=issue.local_state.last_interacted_at,
                )
            ),
            first_seen_at=issue.first_seen_at,
            synced_at=issue.synced_at,
            project_items=[
                (
                    ProjectItemPayload.summary_from_domain(project_item)
                    if compact
                    else ProjectItemPayload.from_domain(project_item)
                )
                for project_item in issue.project_items
            ],
            details_loaded=not compact,
        )


class SnapshotMetaPayload(CamelModel):
    """Represent snapshot metadata for the HTTP response."""

    source: Literal["live", "cache"]
    refreshed_at: str
    closed_window_months: int | None = None
    closed_window_amount: int | None = None
    closed_window_unit: Literal["days", "months", "years"] | None = None
    project_fields_warning: str | None = None

    @classmethod
    def from_domain(cls, snapshot: IssueDashboardSnapshot) -> Self:
        """Build snapshot metadata from a domain snapshot."""
        return cls(
            source=snapshot.source,
            refreshed_at=snapshot.refreshed_at,
            closed_window_months=(
                snapshot.closed_window.amount
                if snapshot.closed_window is not None
                and snapshot.closed_window.unit == "months"
                else None
            ),
            closed_window_amount=(
                snapshot.closed_window.amount
                if snapshot.closed_window is not None
                else None
            ),
            closed_window_unit=(
                snapshot.closed_window.unit
                if snapshot.closed_window is not None
                else None
            ),
            project_fields_warning=snapshot.project_fields_warning,
        )


class SnapshotResponse(CamelModel):
    """Represent the dashboard snapshot response body."""

    issues: list[IssuePayload]
    meta: SnapshotMetaPayload

    @classmethod
    def from_domain(
        cls,
        snapshot: IssueDashboardSnapshot,
        *,
        compact: bool = False,
    ) -> Self:
        """Build a snapshot response from a domain snapshot."""
        return cls(
            issues=[
                IssuePayload.from_domain(issue, compact=compact)
                for issue in snapshot.issues
            ],
            meta=SnapshotMetaPayload.from_domain(snapshot),
        )


class GitHubSessionPayload(CamelModel):
    """Represent the credentials payload used to persist a local session."""

    token: str = ""


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
