"""Resolve and validate the identity represented by a GitHub token."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx

from dashboard_api.application.issues.service import GitHubAuthenticationError

if TYPE_CHECKING:
    from dashboard_api.settings import AppSettings


@dataclass(frozen=True, slots=True)
class GitHubIdentity:
    """Represent the authenticated login and granted OAuth scopes."""

    login: str
    scopes: tuple[str, ...]


class GitHubIdentityClient:
    """Validate tokens against GitHub's authenticated-user endpoint."""

    def __init__(
        self,
        settings: AppSettings,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        """Store API settings and optional test transport."""
        self._settings = settings
        self._transport = transport

    def resolve(self, token: str) -> GitHubIdentity:
        """Return the GitHub account represented by a token."""
        normalized_token = token.strip()
        if not normalized_token:
            message = "Debes introducir un token de GitHub."
            raise ValueError(message)
        with httpx.Client(
            base_url=self._settings.github_api_base_url,
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {normalized_token}",
                "User-Agent": "github-issues-dashboard-v3",
            },
            timeout=self._settings.github_request_timeout_seconds,
            transport=self._transport,
        ) as client:
            response = client.get("/user")
        if response.status_code in {
            httpx.codes.FORBIDDEN,
            httpx.codes.UNAUTHORIZED,
        }:
            message = "GitHub no ha aceptado el token configurado."
            raise GitHubAuthenticationError(message, response.status_code)
        response.raise_for_status()
        payload = response.json()
        login = payload.get("login") if isinstance(payload, dict) else None
        if not isinstance(login, str) or not login.strip():
            message = "GitHub no ha devuelto un usuario válido para este token."
            raise ValueError(message)
        raw_scopes = response.headers.get("x-oauth-scopes", "")
        scopes = tuple(
            scope.strip() for scope in raw_scopes.split(",") if scope.strip()
        )
        return GitHubIdentity(login=login.strip(), scopes=scopes)


__all__ = ["GitHubIdentity", "GitHubIdentityClient"]
