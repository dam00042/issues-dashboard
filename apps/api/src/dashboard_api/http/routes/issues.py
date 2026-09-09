"""Expose issue dashboard routes."""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated, cast

from fastapi import APIRouter, HTTPException, Query, Request, status

from dashboard_api.http.schemas import (
    IssueCompletionUpdatePayload,
    IssueNotesUpdatePayload,
    IssuePayload,
    IssuePinUpdatePayload,
    IssuePriorityUpdatePayload,
    SnapshotResponse,
    SyncStateItemPayload,
    SyncStatesPayload,
)
from dashboard_api.http.window_parsing import parse_closed_issue_window

if TYPE_CHECKING:
    from dashboard_api.issues.service import (
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


@router.get("/snapshot", response_model=SnapshotResponse)
def get_snapshot(
    request: Request,
    closed_window: Annotated[
        str,
        Query(),
    ] = "6m",
    compact: Annotated[bool, Query()] = False,  # noqa: FBT002
) -> SnapshotResponse:
    """Return a merged dashboard snapshot for the selected closed window."""
    snapshot_service = _get_snapshot_service(request)
    try:
        parsed_closed_window = parse_closed_issue_window(closed_window)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    snapshot = snapshot_service.build_snapshot(parsed_closed_window)
    return SnapshotResponse.from_domain(snapshot, compact=compact)


@router.get("/{issue_key:path}", response_model=IssuePayload)
def get_issue_detail(issue_key: str, request: Request) -> IssuePayload:
    """Return a complete issue detail from SQLite without remote I/O."""
    issue = _get_snapshot_service(request).get_issue(issue_key)
    if issue is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="La issue no está disponible en la caché local.",
        )
    return IssuePayload.from_domain(issue)


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
