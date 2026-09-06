"""Expose the single dashboard-wide GitHub synchronization pipeline."""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from fastapi import APIRouter, HTTPException, Request, status

from dashboard_api.application.issues.service import GitHubAuthenticationError
from dashboard_api.presentation.http.schemas import (
    SynchronizationRequest,
    SynchronizationResponse,
    SynchronizationStatusPayload,
)
from dashboard_api.presentation.http.window_parsing import (
    parse_closed_issue_window,
    parse_pull_request_window,
)

if TYPE_CHECKING:
    from dashboard_api.application.synchronization.service import (
        DashboardSynchronizationService,
    )

router = APIRouter(prefix="/api/synchronization", tags=["synchronization"])


def _get_service(request: Request) -> DashboardSynchronizationService:
    """Return the configured synchronization service."""
    return cast(
        "DashboardSynchronizationService",
        request.app.state.synchronization_service,
    )


@router.get("/status", response_model=SynchronizationStatusPayload)
def get_synchronization_status(request: Request) -> SynchronizationStatusPayload:
    """Return the latest synchronization state without remote I/O."""
    return SynchronizationStatusPayload.from_domain(
        _get_service(request).get_status(),
    )


@router.post("", response_model=SynchronizationResponse)
def synchronize_dashboard(
    payload: SynchronizationRequest,
    request: Request,
) -> SynchronizationResponse:
    """Refresh issues, Projects and Pull Requests through one command."""
    try:
        closed_window = parse_closed_issue_window(payload.closed_window)
        pull_request_window = parse_pull_request_window(
            payload.pull_request_window,
        )
        result = _get_service(request).synchronize(
            closed_window,
            pull_request_window,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    except GitHubAuthenticationError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail=str(error),
        ) from error
    return SynchronizationResponse.from_domain(result)


__all__ = ["router"]
