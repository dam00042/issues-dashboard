"""Expose issue dashboard routes."""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated, cast

from fastapi import APIRouter, HTTPException, Query, Request, status

from dashboard_api.application.issues.service import (
    GitHubAuthenticationError,
)
from dashboard_api.presentation.http.schemas import (
    IssueCompletionUpdatePayload,
    IssueNotesUpdatePayload,
    IssuePinUpdatePayload,
    IssuePriorityUpdatePayload,
    SnapshotResponse,
    SyncStateItemPayload,
    SyncStatesPayload,
)

if TYPE_CHECKING:
    from dashboard_api.application.issues.service import (
        IssueDashboardSnapshotService,
        IssueLocalStateCommandService,
        IssueLocalStateSyncService,
    )

router = APIRouter(prefix="/api/issues", tags=["issues"])


def _get_snapshot_service(request: Request) -> IssueDashboardSnapshotService:
    """Return the request-scoped snapshot service."""
    return cast("IssueDashboardSnapshotService", request.app.state.snapshot_service)


def _get_sync_service(request: Request) -> IssueLocalStateSyncService:
    """Return the request-scoped local state sync service."""
    return cast("IssueLocalStateSyncService", request.app.state.sync_service)


def _get_command_service(request: Request) -> IssueLocalStateCommandService:
    """Return the request-scoped local state command service."""
    return cast("IssueLocalStateCommandService", request.app.state.command_service)


def _parse_closed_window_months(raw_value: str) -> int | None:
    """Parse the closed-window query into months or the all sentinel."""
    normalized_value = raw_value.strip().lower()
    if normalized_value == "all":
        return None

    try:
        parsed_months = int(normalized_value)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="closed_window debe ser 'all' o un entero positivo.",
        ) from error

    if parsed_months <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="closed_window debe ser 'all' o un entero positivo.",
        )

    return parsed_months


@router.get("/snapshot", response_model=SnapshotResponse)
def get_snapshot(
    request: Request,
    closed_window: Annotated[
        str,
        Query(),
    ] = "6",
) -> SnapshotResponse:
    """Return a merged dashboard snapshot for the selected closed window."""
    snapshot_service = _get_snapshot_service(request)
    closed_window_months = _parse_closed_window_months(closed_window)
    try:
        snapshot = snapshot_service.build_snapshot(closed_window_months)
    except GitHubAuthenticationError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail=str(error),
        ) from error

    return SnapshotResponse.from_domain(snapshot)


@router.post("/sync-state", response_model=dict[str, int])
def sync_state_changes(
    payload: SyncStatesPayload,
    request: Request,
) -> dict[str, int]:
    """Persist one batch of local issue state changes."""
    sync_service = _get_sync_service(request)
    updated_states = sync_service.sync_states(payload.to_domain())
    return {"updated": updated_states}


@router.post("/state", response_model=dict[str, int])
@router.patch("/state", response_model=dict[str, int])
def sync_single_state_change(
    payload: SyncStateItemPayload,
    request: Request,
) -> dict[str, int]:
    """Persist one immediate local issue state change."""
    sync_service = _get_sync_service(request)
    updated_states = sync_service.sync_states((payload.to_domain(),))
    return {"updated": updated_states}


@router.patch("/priority", response_model=dict[str, int])
def update_issue_priority(
    payload: IssuePriorityUpdatePayload,
    request: Request,
) -> dict[str, int]:
    """Persist one priority mutation for a tracked issue."""
    command_service = _get_command_service(request)
    updated_states = command_service.set_priority(
        payload.to_target(),
        payload.priority,
    )
    return {"updated": updated_states}


@router.patch("/pin", response_model=dict[str, int])
def update_issue_pin(
    payload: IssuePinUpdatePayload,
    request: Request,
) -> dict[str, int]:
    """Persist one pin-state mutation for a tracked issue."""
    command_service = _get_command_service(request)
    updated_states = command_service.set_pin_state(
        payload.to_target(),
        is_pinned=payload.is_pinned,
    )
    return {"updated": updated_states}


@router.put("/completion", response_model=dict[str, int])
def update_issue_completion(
    payload: IssueCompletionUpdatePayload,
    request: Request,
) -> dict[str, int]:
    """Persist one completion-state mutation for a tracked issue."""
    if (payload.state.local_completed_at is not None) != payload.is_completed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="El payload de completion no coincide con el estado enviado.",
        )

    sync_service = _get_sync_service(request)
    updated_states = sync_service.sync_states((payload.to_domain(),))
    return {"updated": updated_states}


@router.put("/notes", response_model=dict[str, int])
def update_issue_notes(
    payload: IssueNotesUpdatePayload,
    request: Request,
) -> dict[str, int]:
    """Persist the current note blocks for one tracked issue."""
    command_service = _get_command_service(request)
    updated_states = command_service.replace_note_blocks(
        payload.to_target(),
        note_blocks=payload.to_note_blocks(),
        last_interacted_at=payload.last_interacted_at,
    )
    return {"updated": updated_states}
