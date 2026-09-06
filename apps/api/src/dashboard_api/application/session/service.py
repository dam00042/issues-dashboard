"""Coordinate the local GitHub session used in development."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from dashboard_api.infrastructure.session.local_session_store import (
        LocalGitHubSessionStore,
    )
    from dashboard_api.settings import AppSettings


class GitHubIdentity(Protocol):
    """Describe the authenticated identity fields needed by the session."""

    login: str


class GitHubIdentityGateway(Protocol):
    """Describe GitHub token validation."""

    def resolve(self, token: str) -> GitHubIdentity:
        """Resolve the account represented by a token."""


@dataclass(frozen=True, slots=True)
class GitHubSessionStatus:
    """Represent whether a usable GitHub session is configured."""

    configured: bool
    username: str | None


class GitHubSessionService:
    """Manage the local GitHub session for development and diagnostics."""

    def __init__(
        self,
        session_store: LocalGitHubSessionStore,
        settings: AppSettings,
        identity_gateway: GitHubIdentityGateway,
    ) -> None:
        """Store the collaborating session store and environment settings."""
        self._session_store = session_store
        self._settings = settings
        self._identity_gateway = identity_gateway

    def get_status(self) -> GitHubSessionStatus:
        """Return whether GitHub credentials are available."""
        stored_session = self._session_store.read_session()
        stored_token = self._session_store.read_token().strip()

        if stored_session and stored_token:
            return GitHubSessionStatus(
                configured=True,
                username=stored_session.username,
            )

        environment_token = self._settings.github_token.strip()
        if environment_token:
            return GitHubSessionStatus(
                configured=True,
                username=None,
            )

        return GitHubSessionStatus(configured=False, username=None)

    def save_session(
        self,
        *,
        token: str,
    ) -> GitHubSessionStatus:
        """Validate and persist a token under its real GitHub account."""
        normalized_token = token.strip()
        if not normalized_token:
            normalized_token = self._session_store.read_token().strip()

        if not normalized_token:
            normalized_token = self._settings.github_token.strip()

        if not normalized_token:
            msg = "Debes introducir un token de GitHub."
            raise ValueError(msg)

        identity = self._identity_gateway.resolve(normalized_token)

        persisted_session = self._session_store.write_session(
            username=identity.login,
            token=normalized_token,
        )
        return GitHubSessionStatus(
            configured=True,
            username=persisted_session.username,
        )

    def clear_session(self) -> GitHubSessionStatus:
        """Remove the stored local session."""
        self._session_store.clear_session()
        return self.get_status()

    def resolve_token(self) -> str:
        """Return the most relevant GitHub token for the current runtime."""
        stored_token = self._session_store.read_token().strip()
        if stored_token:
            return stored_token

        return self._settings.github_token.strip()


__all__ = ["GitHubSessionService", "GitHubSessionStatus"]
