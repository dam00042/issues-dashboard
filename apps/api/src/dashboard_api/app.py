"""Create the FastAPI application."""

from __future__ import annotations

import hmac
from contextlib import asynccontextmanager
from threading import Lock
from typing import TYPE_CHECKING, cast

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, Response

from dashboard_api import __version__
from dashboard_api.backups import (
    BackupManifestContext,
    DashboardBackupService,
)
from dashboard_api.github.client import (
    GitHubAssignedIssuesClient,
)
from dashboard_api.github.identity import GitHubIdentityClient
from dashboard_api.http.routes.backups import router as backups_router
from dashboard_api.http.routes.github_activity import (
    router as github_activity_router,
)
from dashboard_api.http.routes.health import (
    router as health_router,
)
from dashboard_api.http.routes.issues import (
    router as issues_router,
)
from dashboard_api.http.routes.preferences import (
    router as preferences_router,
)
from dashboard_api.http.routes.session import (
    router as session_router,
)
from dashboard_api.http.routes.synchronization import (
    router as synchronization_router,
)
from dashboard_api.issues.service import (
    AssignedIssuesGateway,
    GitHubActivityGateway,
    GitHubActivityService,
    IssueDashboardSnapshotService,
    IssueLocalStateCommandService,
    IssueLocalStateSyncService,
)
from dashboard_api.persistence.session_store import (
    LocalGitHubSessionStore,
)
from dashboard_api.persistence.sqlite_repository import (
    SqliteTrackedIssueRepository,
)
from dashboard_api.preferences import JsonPreferencesStore
from dashboard_api.session import (
    GitHubSessionService,
)
from dashboard_api.settings import AppSettings, get_settings
from dashboard_api.synchronization import (
    DashboardSynchronizationService,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Awaitable, Callable


def create_app(
    settings: AppSettings | None = None,
    github_client: AssignedIssuesGateway | None = None,
    github_identity_client: GitHubIdentityClient | None = None,
) -> FastAPI:
    """Create the FastAPI application and register its dependencies."""
    resolved_settings = settings or get_settings()
    repository = SqliteTrackedIssueRepository(resolved_settings.issues_database_path)
    preferences_store = JsonPreferencesStore(resolved_settings.preferences_path)
    session_store = LocalGitHubSessionStore(
        resolved_settings.github_session_path,
        resolved_settings.github_session_key_path,
    )
    resolved_identity_client = github_identity_client or GitHubIdentityClient(
        resolved_settings,
    )
    session_service = GitHubSessionService(
        session_store=session_store,
        settings=resolved_settings,
        identity_gateway=resolved_identity_client,
    )
    resolved_github_client = github_client or GitHubAssignedIssuesClient(
        resolved_settings,
        token_provider=session_service.resolve_token,
    )
    snapshot_service = IssueDashboardSnapshotService(
        repository=repository,
        gateway=resolved_github_client,
    )
    github_activity_service = GitHubActivityService(
        gateway=cast("GitHubActivityGateway", resolved_github_client),
        repository=repository,
    )
    sync_service = IssueLocalStateSyncService(repository=repository)
    command_service = IssueLocalStateCommandService(repository=repository)
    remote_operation_lock = Lock()
    synchronization_service = DashboardSynchronizationService(
        snapshot_service=snapshot_service,
        github_activity_service=github_activity_service,
        run_lock=remote_operation_lock,
    )
    backup_service = DashboardBackupService(
        database=repository.database,
        preferences_store=preferences_store,
        manifest_context=BackupManifestContext(
            app_version=__version__,
            account_provider=lambda: session_service.get_status().username,
        ),
        restore_lock=remote_operation_lock,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        """Initialize the persistence schema and attach services to the app."""
        repository.initialize_schema()
        app.state.schema_version = repository.database.schema_version()
        app.state.snapshot_service = snapshot_service
        app.state.command_service = command_service
        app.state.sync_service = sync_service
        app.state.session_service = session_service
        app.state.github_activity_service = github_activity_service
        app.state.preferences_store = preferences_store
        app.state.backup_service = backup_service
        app.state.synchronization_service = synchronization_service
        try:
            yield
        finally:
            close_client = getattr(resolved_github_client, "close", None)
            if callable(close_client):
                close_client()

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
    app.add_middleware(GZipMiddleware, minimum_size=1_024, compresslevel=5)
    if resolved_settings.runtime_secret:

        @app.middleware("http")
        async def require_runtime_secret(
            request: Request,
            call_next: Callable[[Request], Awaitable[Response]],
        ) -> Response:
            """Reject local API calls that do not come from the bundled UI."""
            if request.url.path == "/health" or request.method == "OPTIONS":
                return await call_next(request)
            supplied_secret = request.headers.get("x-dashboard-runtime-secret", "")
            if not hmac.compare_digest(
                supplied_secret,
                resolved_settings.runtime_secret,
            ):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Acceso local no autorizado."},
                )
            return await call_next(request)

    app.include_router(health_router)
    app.include_router(backups_router)
    app.include_router(github_activity_router)
    app.include_router(issues_router)
    app.include_router(preferences_router)
    app.include_router(session_router)
    app.include_router(synchronization_router)
    return app


app = create_app()
