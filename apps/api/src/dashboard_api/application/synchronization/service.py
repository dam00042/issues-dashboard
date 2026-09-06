"""Coordinate one non-overlapping refresh of all GitHub projections."""

from __future__ import annotations

from dataclasses import dataclass
from threading import Lock, RLock
from typing import TYPE_CHECKING, Literal

from dashboard_api.shared.time import utc_now_iso

if TYPE_CHECKING:
    from _thread import LockType

    from dashboard_api.application.issues.service import (
        GitHubActivityService,
        IssueDashboardSnapshotService,
    )
    from dashboard_api.domain.issues.models import ClosedIssueWindow, PullRequestWindow

SynchronizationState = Literal["idle", "running", "succeeded", "partial"]


@dataclass(frozen=True, slots=True)
class SynchronizationStatus:
    """Represent observable state for the single synchronization pipeline."""

    state: SynchronizationState = "idle"
    started_at: str | None = None
    finished_at: str | None = None
    issues_refreshed_at: str | None = None
    pull_requests_refreshed_at: str | None = None
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class SynchronizationResult:
    """Describe one synchronization request."""

    started: bool
    status: SynchronizationStatus


class DashboardSynchronizationService:
    """Refresh issues, Projects and Pull Requests through one pipeline."""

    def __init__(
        self,
        *,
        snapshot_service: IssueDashboardSnapshotService,
        github_activity_service: GitHubActivityService,
        run_lock: LockType | None = None,
    ) -> None:
        """Store services and initialize single-flight state."""
        self._snapshot_service = snapshot_service
        self._github_activity_service = github_activity_service
        self._run_lock = run_lock or Lock()
        self._state_lock = RLock()
        self._status = SynchronizationStatus()

    def get_status(self) -> SynchronizationStatus:
        """Return the latest immutable synchronization status."""
        with self._state_lock:
            return self._status

    def synchronize(
        self,
        closed_window: ClosedIssueWindow | None,
        pull_request_window: PullRequestWindow,
    ) -> SynchronizationResult:
        """Refresh all remote projections once without overlapping work."""
        if not self._run_lock.acquire(blocking=False):
            return SynchronizationResult(started=False, status=self.get_status())

        started_at = utc_now_iso()
        self._set_status(
            SynchronizationStatus(state="running", started_at=started_at),
        )
        try:
            issue_snapshot = self._snapshot_service.refresh_snapshot(closed_window)
            pull_request_dashboard = self._github_activity_service.get_pull_requests(
                pull_request_window,
                refresh=True,
            )
            warnings = tuple(
                warning
                for warning in (
                    issue_snapshot.project_fields_warning,
                    pull_request_dashboard.warning,
                )
                if warning
            )
            next_status = SynchronizationStatus(
                state="partial" if warnings else "succeeded",
                started_at=started_at,
                finished_at=utc_now_iso(),
                issues_refreshed_at=issue_snapshot.refreshed_at,
                pull_requests_refreshed_at=(pull_request_dashboard.refreshed_at),
                warnings=warnings,
            )
            self._set_status(next_status)
            return SynchronizationResult(started=True, status=next_status)
        except Exception:
            self._set_status(
                SynchronizationStatus(
                    state="partial",
                    started_at=started_at,
                    finished_at=utc_now_iso(),
                    warnings=("La sincronización no pudo completarse.",),
                ),
            )
            raise
        finally:
            self._run_lock.release()

    def _set_status(self, status: SynchronizationStatus) -> None:
        """Replace observable status under a small state lock."""
        with self._state_lock:
            self._status = status


__all__ = [
    "DashboardSynchronizationService",
    "SynchronizationResult",
    "SynchronizationStatus",
]
