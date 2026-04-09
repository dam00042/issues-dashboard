"""Expose local GitHub session routes."""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from fastapi import APIRouter, HTTPException, Request, status

from dashboard_api.presentation.http.schemas import (
    GitHubSessionPayload,
    GitHubSessionStatusPayload,
)

if TYPE_CHECKING:
    from dashboard_api.application.session.service import (
        GitHubSessionService,
    )

router = APIRouter(prefix="/api/session", tags=["session"])


def _get_session_service(request: Request) -> GitHubSessionService:
    """Return the request-scoped session service."""
    return cast("GitHubSessionService", request.app.state.session_service)


@router.get("/status", response_model=GitHubSessionStatusPayload)
def get_session_status(request: Request) -> GitHubSessionStatusPayload:
    """Return whether a usable local GitHub session is configured."""
    session_service = _get_session_service(request)
    return GitHubSessionStatusPayload.from_domain(session_service.get_status())


@router.post("", response_model=GitHubSessionStatusPayload)
def save_session(
    payload: GitHubSessionPayload,
    request: Request,
) -> GitHubSessionStatusPayload:
    """Persist the provided local GitHub session."""
    session_service = _get_session_service(request)

    try:
        session_status = session_service.save_session(
            token=payload.token,
            username=payload.username,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error

    return GitHubSessionStatusPayload.from_domain(session_status)


@router.delete("", response_model=GitHubSessionStatusPayload)
def clear_session(request: Request) -> GitHubSessionStatusPayload:
    """Clear the stored local GitHub session."""
    session_service = _get_session_service(request)
    return GitHubSessionStatusPayload.from_domain(session_service.clear_session())
