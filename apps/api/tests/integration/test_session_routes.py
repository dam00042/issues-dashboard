"""Test the local session routes end to end."""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

from dashboard_api.app.main import create_app
from dashboard_api.application.issues.service import (
    GitHubAuthenticationError,
)
from dashboard_api.settings import AppSettings

HTTP_OK = 200
HTTP_UNAUTHORIZED = 401


class EmptyGitHubAssignedIssuesClient:
    """Provide a no-op gateway for session route tests."""

    def can_refresh(self) -> bool:
        """Report that no refresh is available."""
        return False

    def fetch_assigned_issues(self) -> tuple[object, ...]:
        """Return no issues."""
        return ()


class UnauthorizedGitHubAssignedIssuesClient:
    """Simulate a GitHub authentication failure."""

    def can_refresh(self) -> bool:
        """Pretend that credentials are configured."""
        return True

    def fetch_assigned_issues(self) -> tuple[object, ...]:
        """Raise the authentication error expected by the HTTP route."""
        message = "GitHub no ha aceptado las credenciales configuradas."
        raise GitHubAuthenticationError(message, status_code=HTTP_UNAUTHORIZED)


class SessionRoutesIntegrationTests(TestCase):
    """Verify the local session lifecycle routes."""

    def setUp(self) -> None:
        """Create a temporary app and test client."""
        self._temp_directory = tempfile.TemporaryDirectory()
        base_path = Path(self._temp_directory.name)
        settings = AppSettings(
            github_session_key_path=base_path / "session.key",
            github_session_path=base_path / "session.json",
            issues_database_path=base_path / "issues.db",
        )
        app = create_app(
            settings=settings,
            github_client=EmptyGitHubAssignedIssuesClient(),
        )
        self._client_context = TestClient(app)
        self.client = self._client_context.__enter__()

    def tearDown(self) -> None:
        """Dispose the test client and temporary storage."""
        self._client_context.__exit__(None, None, None)
        self._temp_directory.cleanup()

    def test_session_status_is_empty_by_default(self) -> None:
        """Report that no local GitHub session is configured initially."""
        response = self.client.get("/api/session/status")

        if response.status_code != HTTP_OK:
            message = "Expected the session status route to succeed."
            raise AssertionError(message)

        payload = response.json()
        if payload["configured"]:
            message = "Did not expect a configured session by default."
            raise AssertionError(message)
        if payload["username"] is not None:
            message = "Did not expect a username when no session is configured."
            raise AssertionError(message)

    def test_session_routes_persist_and_clear_local_credentials(self) -> None:
        """Store and later clear the local GitHub session."""
        save_response = self.client.post(
            "/api/session",
            json={
                "token": "ghp_example_token",
                "username": "octocat",
            },
        )
        status_response = self.client.get("/api/session/status")
        clear_response = self.client.delete("/api/session")

        if save_response.status_code != HTTP_OK:
            message = "Expected the session save route to succeed."
            raise AssertionError(message)
        if status_response.status_code != HTTP_OK:
            message = "Expected the session status route to succeed."
            raise AssertionError(message)
        if clear_response.status_code != HTTP_OK:
            message = "Expected the session clear route to succeed."
            raise AssertionError(message)

        saved_payload = save_response.json()
        if not saved_payload["configured"]:
            message = "Expected the saved session to be reported as configured."
            raise AssertionError(message)
        if saved_payload["username"] != "octocat":
            message = "Expected the saved username to be returned."
            raise AssertionError(message)

        status_payload = status_response.json()
        if not status_payload["configured"]:
            message = "Expected the stored session to be visible on status reads."
            raise AssertionError(message)
        if status_payload["username"] != "octocat":
            message = "Expected the stored username to match the saved one."
            raise AssertionError(message)

        cleared_payload = clear_response.json()
        if cleared_payload["configured"]:
            message = "Did not expect a configured session after clearing it."
            raise AssertionError(message)


class SnapshotAuthenticationIntegrationTests(TestCase):
    """Verify that invalid GitHub credentials are surfaced to the client."""

    def setUp(self) -> None:
        """Create a temporary app and test client."""
        self._temp_directory = tempfile.TemporaryDirectory()
        base_path = Path(self._temp_directory.name)
        configured_settings = {
            "github_session_key_path": base_path / "session.key",
            "github_session_path": base_path / "session.json",
            "github_token": "ghs_invalid",
            "issues_database_path": base_path / "issues.db",
        }
        settings = AppSettings(**configured_settings)
        app = create_app(
            settings=settings,
            github_client=UnauthorizedGitHubAssignedIssuesClient(),
        )
        self._client_context = TestClient(app)
        self.client = self._client_context.__enter__()

    def tearDown(self) -> None:
        """Dispose the test client and temporary storage."""
        self._client_context.__exit__(None, None, None)
        self._temp_directory.cleanup()

    def test_snapshot_rejects_invalid_github_credentials(self) -> None:
        """Return an authentication error instead of silently serving cache."""
        response = self.client.get(
            "/api/issues/snapshot",
            params={"closed_window": "all"},
        )

        if response.status_code != HTTP_UNAUTHORIZED:
            message = "Expected invalid GitHub credentials to produce HTTP 401."
            raise AssertionError(message)

        payload = response.json()
        if "credenciales" not in payload["detail"].lower():
            message = "Expected the snapshot error to mention invalid credentials."
            raise AssertionError(message)
