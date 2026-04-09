"""Create the FastAPI application."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from dashboard_api import __version__
from dashboard_api.application.issues.service import (
    AssignedIssuesGateway,
    IssueDashboardSnapshotService,
    IssueLocalStateCommandService,
    IssueLocalStateSyncService,
)
from dashboard_api.application.session.service import (
    GitHubSessionService,
)
from dashboard_api.infrastructure.github.client import (
    GitHubAssignedIssuesClient,
)
from dashboard_api.infrastructure.persistence.sqlite_repository import (
    SqliteTrackedIssueRepository,
)
from dashboard_api.infrastructure.session.local_session_store import (
    LocalGitHubSessionStore,
)
from dashboard_api.presentation.http.routes.health import (
    router as health_router,
)
from dashboard_api.presentation.http.routes.issues import (
    router as issues_router,
)
from dashboard_api.presentation.http.routes.session import (
    router as session_router,
)
from dashboard_api.settings import AppSettings, get_settings

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


def create_app(
    settings: AppSettings | None = None,
    github_client: AssignedIssuesGateway | None = None,
) -> FastAPI:
    """Create the FastAPI application and register its dependencies."""
    resolved_settings = settings or get_settings()
    repository = SqliteTrackedIssueRepository(resolved_settings.issues_database_path)
    session_store = LocalGitHubSessionStore(
        resolved_settings.github_session_path,
        resolved_settings.github_session_key_path,
    )
    session_service = GitHubSessionService(
        session_store=session_store,
        settings=resolved_settings,
    )
    resolved_github_client = github_client or GitHubAssignedIssuesClient(
        resolved_settings,
        token_provider=session_service.resolve_token,
    )
    snapshot_service = IssueDashboardSnapshotService(
        repository=repository,
        gateway=resolved_github_client,
    )
    sync_service = IssueLocalStateSyncService(repository=repository)
    command_service = IssueLocalStateCommandService(repository=repository)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        """Initialize the persistence schema and attach services to the app."""
        repository.initialize_schema()
        app.state.snapshot_service = snapshot_service
        app.state.command_service = command_service
        app.state.sync_service = sync_service
        app.state.session_service = session_service
        yield

    app = FastAPI(
        title="GitHub Issues Dashboard API",
        version=__version__,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved_settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router)
    app.include_router(issues_router)
    app.include_router(session_router)
    return app


app = create_app()
