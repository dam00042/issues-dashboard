"""Expose on-demand GitHub Pull Request activity."""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated, cast

from fastapi import APIRouter, HTTPException, Query, Request, status

from dashboard_api.http.schemas import PullRequestDashboardResponse
from dashboard_api.http.window_parsing import parse_pull_request_window
from dashboard_api.issues.service import GitHubAuthenticationError

if TYPE_CHECKING:
    from dashboard_api.issues.service import GitHubActivityService


router = APIRouter(prefix="/api/github", tags=["github-activity"])


def _get_activity_service(request: Request) -> GitHubActivityService:
    """Return the configured GitHub activity service."""
    return cast("GitHubActivityService", request.app.state.github_activity_service)


@router.get("/pull-requests", response_model=PullRequestDashboardResponse)
def get_pull_requests(
    request: Request,
    history_window: Annotated[str, Query(alias="window")] = "1m",
) -> PullRequestDashboardResponse:
    """Return cached Pull Requests without performing remote I/O."""
    try:
        dashboard = _get_activity_service(request).get_pull_requests(
            parse_pull_request_window(history_window),
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    except GitHubAuthenticationError as error:
        raise HTTPException(error.status_code, str(error)) from error
    return PullRequestDashboardResponse.from_domain(dashboard)
