"""Fetch assigned issues from the GitHub REST API."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

import httpx
from pydantic import BaseModel, ConfigDict, TypeAdapter

from dashboard_api.application.issues.service import (
    GitHubAuthenticationError,
)
from dashboard_api.domain.issues.models import GitHubAssignedIssue
from dashboard_api.shared.time import normalize_utc_iso

if TYPE_CHECKING:
    from collections.abc import Callable

    from dashboard_api.settings import AppSettings


ISSUES_PAGE_SIZE = 100


class GitHubOwnerPayload(BaseModel):
    """Represent the owner payload returned by GitHub."""

    model_config = ConfigDict(extra="ignore")

    login: str = ""
    avatar_url: str = ""


class GitHubRepositoryPayload(BaseModel):
    """Represent the repository payload returned by GitHub."""

    model_config = ConfigDict(extra="ignore")

    full_name: str
    name: str
    owner: GitHubOwnerPayload


class GitHubIssuePayload(BaseModel):
    """Represent the assigned issue payload returned by GitHub."""

    model_config = ConfigDict(extra="ignore")

    id: int
    number: int
    state: Literal["open", "closed"]
    title: str = ""
    body: str | None = None
    html_url: str
    created_at: str | None = None
    updated_at: str | None = None
    closed_at: str | None = None
    repository: GitHubRepositoryPayload
    pull_request: dict[str, object] | None = None


GITHUB_ISSUES_ADAPTER = TypeAdapter(list[GitHubIssuePayload])


class GitHubAssignedIssuesClient:
    """Read assigned issues for the authenticated GitHub user."""

    def __init__(
        self,
        settings: AppSettings,
        token_provider: Callable[[], str] | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        """Store the settings and optional HTTP transport."""
        self._settings = settings
        self._token_provider = token_provider
        self._transport = transport

    def can_refresh(self) -> bool:
        """Return whether the configured token can refresh GitHub data."""
        return bool(self._resolve_token())

    def fetch_assigned_issues(self) -> tuple[GitHubAssignedIssue, ...]:
        """Fetch all assigned issues across the configured page window."""
        github_token = self._resolve_token()
        if not github_token:
            return ()

        collected_issues: list[GitHubAssignedIssue] = []
        headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {github_token}",
            "User-Agent": "github-issues-dashboard-v3",
        }

        with httpx.Client(
            base_url=self._settings.github_api_base_url,
            headers=headers,
            timeout=self._settings.github_request_timeout_seconds,
            transport=self._transport,
        ) as client:
            for page in range(1, self._settings.github_max_pages + 1):
                raw_issues = self._fetch_page(client=client, page=page)
                collected_issues.extend(
                    self._to_domain(issue_payload)
                    for issue_payload in raw_issues
                    if issue_payload.pull_request is None
                )
                if len(raw_issues) < ISSUES_PAGE_SIZE:
                    break

        return tuple(collected_issues)

    def _fetch_page(
        self,
        client: httpx.Client,
        page: int,
    ) -> tuple[GitHubIssuePayload, ...]:
        """Fetch and validate one GitHub assigned-issues page."""
        response = client.get(
            "/issues",
            params={
                "direction": "desc",
                "filter": "assigned",
                "page": page,
                "per_page": ISSUES_PAGE_SIZE,
                "sort": "updated",
                "state": "all",
            },
        )
        if response.status_code in {
            httpx.codes.FORBIDDEN,
            httpx.codes.UNAUTHORIZED,
        }:
            raise GitHubAuthenticationError(
                message=self._build_auth_error_message(response),
                status_code=response.status_code,
            )

        response.raise_for_status()
        payload = GITHUB_ISSUES_ADAPTER.validate_python(response.json())
        return tuple(payload)

    def _resolve_token(self) -> str:
        """Return the active GitHub token for the current runtime."""
        if self._token_provider is None:
            return self._settings.github_token.strip()

        return self._token_provider().strip()

    @staticmethod
    def _build_auth_error_message(response: httpx.Response) -> str:
        """Return a human-friendly GitHub authentication error message."""
        default_message = (
            "GitHub no ha aceptado las credenciales configuradas. "
            "Revisa el usuario y el token."
        )

        try:
            payload = response.json()
        except ValueError:
            return default_message

        if not isinstance(payload, dict):
            return default_message

        raw_message = payload.get("message")
        if not isinstance(raw_message, str) or not raw_message.strip():
            return default_message

        return f"{default_message} GitHub respondiÃ³: {raw_message.strip()}."

    @staticmethod
    def _to_domain(issue_payload: GitHubIssuePayload) -> GitHubAssignedIssue:
        """Map a validated GitHub payload into a domain issue."""
        repository = issue_payload.repository
        return GitHubAssignedIssue(
            github_id=issue_payload.id,
            repository_full_name=repository.full_name,
            repository_name=repository.name,
            repository_owner_login=repository.owner.login,
            repository_owner_avatar_url=repository.owner.avatar_url,
            issue_number=issue_payload.number,
            remote_state=issue_payload.state,
            title=issue_payload.title,
            body_markdown=issue_payload.body or "",
            html_url=issue_payload.html_url,
            created_at=normalize_utc_iso(issue_payload.created_at),
            updated_at=normalize_utc_iso(issue_payload.updated_at),
            closed_at=normalize_utc_iso(issue_payload.closed_at),
        )


__all__ = ["GitHubAssignedIssuesClient"]
