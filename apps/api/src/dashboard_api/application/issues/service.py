"""Define application services for the issue dashboard."""

from __future__ import annotations

import logging
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Literal, Protocol

import httpx

from dashboard_api.domain.issues.defaults import default_local_state
from dashboard_api.domain.issues.models import IssueLocalStateChange
from dashboard_api.shared.time import utc_now_iso

if TYPE_CHECKING:
    from collections.abc import Callable

    from dashboard_api.domain.issues.models import (
        GitHubAssignedIssue,
        IssueLocalState,
        NoteBlock,
        PriorityValue,
        TrackedIssue,
    )


LOGGER = logging.getLogger(__name__)
SnapshotSource = Literal["live", "cache"]


class GitHubAuthenticationError(Exception):
    """Represent an authentication failure returned by GitHub."""

    def __init__(self, message: str, status_code: int = 401) -> None:
        """Store the HTTP status code returned by GitHub."""
        super().__init__(message)
        self.status_code = status_code


class AssignedIssuesGateway(Protocol):
    """Describe the remote gateway used to refresh assigned issues."""

    def can_refresh(self) -> bool:
        """Return whether the gateway has enough credentials to refresh data."""

    def fetch_assigned_issues(self) -> tuple[GitHubAssignedIssue, ...]:
        """Fetch the currently assigned issues from GitHub."""


class TrackedIssuesRepository(Protocol):
    """Describe the persistence contract for tracked issues."""

    def initialize_schema(self) -> None:
        """Initialize the required persistence schema."""

    def replace_remote_projection(
        self,
        remote_issues: tuple[GitHubAssignedIssue, ...],
    ) -> None:
        """Replace the remote projection with the latest fetched issues."""

    def list_visible_issues(
        self,
        closed_window_months: int | None,
    ) -> tuple[TrackedIssue, ...]:
        """List the issues visible for the requested closed-window filter."""

    def get_tracked_issue(self, issue_key: str) -> TrackedIssue | None:
        """Return one tracked issue when it has already been persisted."""

    def upsert_local_states(
        self,
        changes: tuple[IssueLocalStateChange, ...],
    ) -> int:
        """Persist the provided local state changes."""


@dataclass(frozen=True, slots=True)
class IssueDashboardSnapshot:
    """Represent a dashboard snapshot returned to the presentation layer."""

    issues: tuple[TrackedIssue, ...]
    source: SnapshotSource
    refreshed_at: str
    closed_window_months: int | None


@dataclass(frozen=True, slots=True)
class IssueLocalStateTarget:
    """Identify the issue whose local state should be mutated."""

    issue_key: str
    github_id: int
    repository_full_name: str
    repository_name: str
    issue_number: int


class IssueDashboardSnapshotService:
    """Build merged dashboard snapshots from GitHub and local persistence."""

    def __init__(
        self,
        repository: TrackedIssuesRepository,
        gateway: AssignedIssuesGateway,
    ) -> None:
        """Store the collaborating repository and gateway."""
        self._repository = repository
        self._gateway = gateway

    def build_snapshot(
        self,
        closed_window_months: int | None,
    ) -> IssueDashboardSnapshot:
        """Build a merged dashboard snapshot for the requested filter."""
        source: SnapshotSource = "cache"

        if self._gateway.can_refresh():
            try:
                remote_issues = self._gateway.fetch_assigned_issues()
            except GitHubAuthenticationError:
                raise
            except httpx.HTTPError as error:
                LOGGER.warning(
                    "Falling back to cached dashboard data after a GitHub refresh "
                    "failure: %s",
                    error,
                )
            else:
                self._repository.replace_remote_projection(remote_issues)
                source = "live"

        issues = self._repository.list_visible_issues(closed_window_months)
        return IssueDashboardSnapshot(
            issues=issues,
            source=source,
            refreshed_at=utc_now_iso(),
            closed_window_months=closed_window_months,
        )


class IssueLocalStateSyncService:
    """Persist local issue state updates from the frontend."""

    def __init__(self, repository: TrackedIssuesRepository) -> None:
        """Store the collaborating repository."""
        self._repository = repository

    def sync_states(self, changes: tuple[IssueLocalStateChange, ...]) -> int:
        """Persist the provided local state changes."""
        return self._repository.upsert_local_states(changes)


class IssueLocalStateCommandService:
    """Apply intent-based local issue state commands."""

    def __init__(self, repository: TrackedIssuesRepository) -> None:
        """Store the collaborating repository."""
        self._repository = repository

    def set_priority(
        self,
        target: IssueLocalStateTarget,
        priority: PriorityValue | None,
    ) -> int:
        """Persist a priority change for the selected issue."""
        interacted_at = utc_now_iso()
        return self._persist_state(
            target,
            lambda current_state: replace(
                current_state,
                priority=priority,
                is_pinned=False if priority is None else current_state.is_pinned,
                last_interacted_at=interacted_at,
            ),
        )

    def set_pin_state(
        self,
        target: IssueLocalStateTarget,
        *,
        is_pinned: bool,
    ) -> int:
        """Persist the pin state for the selected issue."""
        interacted_at = utc_now_iso()
        return self._persist_state(
            target,
            lambda current_state: replace(
                current_state,
                is_pinned=is_pinned and current_state.priority is not None,
                last_interacted_at=interacted_at,
            ),
        )

    def set_completion_state(
        self,
        target: IssueLocalStateTarget,
        *,
        is_completed: bool,
    ) -> int:
        """Persist the local completion state for the selected issue."""
        interacted_at = utc_now_iso()
        if is_completed:
            return self._persist_state(
                target,
                lambda current_state: replace(
                    current_state,
                    is_pinned=False,
                    last_pinned_before_completion=current_state.is_pinned,
                    last_priority_before_completion=current_state.priority,
                    local_completed_at=interacted_at,
                    priority=None,
                    last_interacted_at=interacted_at,
                ),
            )

        return self._persist_state(
            target,
            lambda current_state: replace(
                current_state,
                is_pinned=current_state.last_pinned_before_completion,
                last_pinned_before_completion=False,
                last_priority_before_completion=None,
                local_completed_at=None,
                priority=current_state.last_priority_before_completion,
                last_interacted_at=interacted_at,
            ),
        )

    def replace_note_blocks(
        self,
        target: IssueLocalStateTarget,
        *,
        note_blocks: tuple[NoteBlock, ...],
        last_interacted_at: str | None,
    ) -> int:
        """Persist the edited note blocks for the selected issue."""
        return self._persist_state(
            target,
            lambda current_state: replace(
                current_state,
                note_blocks=note_blocks,
                last_interacted_at=last_interacted_at or utc_now_iso(),
            ),
        )

    def _persist_state(
        self,
        target: IssueLocalStateTarget,
        update_state: Callable[[IssueLocalState], IssueLocalState],
    ) -> int:
        """Load the current state, apply one mutation, and persist it."""
        tracked_issue = self._repository.get_tracked_issue(target.issue_key)
        current_state = (
            tracked_issue.local_state
            if tracked_issue is not None
            else default_local_state()
        )
        next_state = update_state(current_state)
        change = IssueLocalStateChange(
            issue_key=target.issue_key,
            github_id=target.github_id,
            repository_full_name=target.repository_full_name,
            repository_name=target.repository_name,
            issue_number=target.issue_number,
            state=next_state,
        )
        return self._repository.upsert_local_states((change,))
