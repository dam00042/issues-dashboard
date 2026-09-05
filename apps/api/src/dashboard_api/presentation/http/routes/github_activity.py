"""Expose on-demand GitHub Pull Request activity."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Annotated, cast

from fastapi import APIRouter, HTTPException, Query, Request, status

from dashboard_api.application.issues.service import GitHubAuthenticationError
from dashboard_api.domain.issues.models import PullRequestWindow
from dashboard_api.presentation.http.schemas import PullRequestDashboardResponse

if TYPE_CHECKING:
    from dashboard_api.application.issues.service import GitHubActivityService


router = APIRouter(prefix="/api/github", tags=["github-activity"])


def _get_activity_service(request: Request) -> GitHubActivityService:
    """Return the configured GitHub activity service."""
    return cast("GitHubActivityService", request.app.state.github_activity_service)


def _parse_pull_request_window(raw_value: str) -> PullRequestWindow:
    """Parse a positive amount of days, months or years."""
    match = re.fullmatch(r"(\d+)([dmy])?", raw_value.strip().lower())
    if match is None or int(match.group(1)) <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="window debe ser un entero positivo con d, m o y.",
        )
    return PullRequestWindow(
        amount=int(match.group(1)),
        unit={"d": "days", "m": "months", "y": "years"}.get(
            match.group(2) or "m",
            "months",
        ),
    )


@router.get("/pull-requests", response_model=PullRequestDashboardResponse)
def get_pull_requests(
    request: Request,
    history_window: Annotated[str, Query(alias="window")] = "1m",
    *,
    refresh: bool = False,
) -> PullRequestDashboardResponse:
    """Return cached Pull Requests and optionally refresh them from GitHub."""
    try:
        dashboard = _get_activity_service(request).get_pull_requests(
            _parse_pull_request_window(history_window),
            refresh=refresh,
        )
    except GitHubAuthenticationError as error:
        raise HTTPException(error.status_code, str(error)) from error
    return PullRequestDashboardResponse.from_domain(dashboard)
