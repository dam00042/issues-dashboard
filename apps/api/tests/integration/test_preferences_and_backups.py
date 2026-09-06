"""Test portable preferences, complete backups and local API protection."""

from __future__ import annotations

import sqlite3
import tempfile
import zipfile
from contextlib import closing
from pathlib import Path
from typing import TYPE_CHECKING
from unittest import TestCase

from fastapi.testclient import TestClient

from dashboard_api.app.main import create_app
from dashboard_api.application.issues.service import (
    AssignedIssuesFetchResult,
    PullRequestFetchResult,
)
from dashboard_api.settings import AppSettings

if TYPE_CHECKING:
    from dashboard_api.domain.issues.models import ClosedIssueWindow, PullRequestWindow

HTTP_OK = 200
HTTP_UNAUTHORIZED = 401
HTTP_UNPROCESSABLE_ENTITY = 422
PERSISTED_PREFERENCES_AMOUNT = 6
BACKUP_PREFERENCES_AMOUNT = 9
BACKUP_PRIORITY = 4
UNCHANGED_PREFERENCES_AMOUNT = 4


class EmptyGitHubClient:
    """Provide a network-free gateway for local persistence tests."""

    def can_refresh(self) -> bool:
        """Report that no remote refresh is configured."""
        return False

    def fetch_assigned_issues(
        self,
        _closed_window: ClosedIssueWindow | None,
    ) -> AssignedIssuesFetchResult:
        """Return no remote issues."""
        return AssignedIssuesFetchResult(issues=())

    def fetch_pull_requests(
        self,
        _window: PullRequestWindow,
        *,
        force: bool = False,
    ) -> PullRequestFetchResult:
        """Return no remote Pull Requests."""
        del force
        return PullRequestFetchResult(pull_requests=())


def _preferences_payload(*, amount: int) -> dict[str, object]:
    """Build a complete portable preferences payload."""
    return {
        "autoRefresh": {"amount": 2, "enabled": True, "unit": "hours"},
        "closedIssueHistory": {
            "amount": amount,
            "unit": "months",
            "unlimited": False,
        },
        "linkedPullRequestsCollapsed": True,
        "pullRequestHistory": {
            "amount": 3,
            "unit": "months",
            "unlimited": False,
        },
        "sidebar": {"collapsed": True, "width": 520},
        "theme": "dark",
        "version": 1,
        "zoomFactor": 1.1,
    }


class PreferencesAndBackupsIntegrationTests(TestCase):
    """Verify persistent settings and safe round-trip backup restoration."""

    def setUp(self) -> None:
        """Create one isolated local application."""
        self._temporary_directory = tempfile.TemporaryDirectory()
        root = Path(self._temporary_directory.name)
        self.settings = AppSettings(
            github_session_key_path=root / "session.key",
            github_session_path=root / "session.json",
            issues_database_path=root / "issues.db",
            preferences_path=root / "preferences.json",
        )
        self._client_context = TestClient(
            create_app(settings=self.settings, github_client=EmptyGitHubClient()),
        )
        self.client = self._client_context.__enter__()

    def tearDown(self) -> None:
        """Close the app before removing its local files."""
        self._client_context.__exit__(None, None, None)
        self._temporary_directory.cleanup()

    def test_preferences_are_typed_and_persist_across_restarts(self) -> None:
        """Store all settings outside browser localStorage."""
        save_response = self.client.put(
            "/api/preferences",
            json=_preferences_payload(amount=PERSISTED_PREFERENCES_AMOUNT),
        )
        if save_response.status_code != HTTP_OK:
            raise AssertionError(save_response.text)

        self._client_context.__exit__(None, None, None)
        self._client_context = TestClient(
            create_app(settings=self.settings, github_client=EmptyGitHubClient()),
        )
        self.client = self._client_context.__enter__()
        stored = self.client.get("/api/preferences")

        if (
            stored.json()["closedIssueHistory"]["amount"]
            != PERSISTED_PREFERENCES_AMOUNT
        ):
            message = "Expected preferences to survive an API restart."
            raise AssertionError(message)
        if stored.json()["autoRefresh"] != {
            "amount": 2,
            "enabled": True,
            "unit": "hours",
        }:
            message = "Expected typed automatic-refresh settings."
            raise AssertionError(message)

    def test_complete_backup_restores_database_and_preferences(self) -> None:
        """Round-trip data and settings through the versioned archive."""
        issue_payload = {
            "githubId": 77,
            "issueKey": "example/repo#7",
            "issueNumber": 7,
            "priority": BACKUP_PRIORITY,
            "repoFullName": "example/repo",
            "repoName": "repo",
        }
        self.client.patch("/api/issues/priority", json=issue_payload)
        self.client.put(
            "/api/preferences",
            json=_preferences_payload(amount=BACKUP_PREFERENCES_AMOUNT),
        )
        backup_destination = Path(self._temporary_directory.name) / "portable"
        export_response = self.client.post(
            "/api/backups/export",
            json={"path": str(backup_destination)},
        )
        if export_response.status_code != HTTP_OK:
            raise AssertionError(export_response.text)
        exported_path = Path(export_response.json()["path"])
        with zipfile.ZipFile(exported_path) as archive:
            if set(archive.namelist()) != {
                "database.sqlite",
                "manifest.json",
                "preferences.json",
            }:
                message = "Expected exactly the portable backup entries."
                raise AssertionError(message)

        self.client.put("/api/preferences", json=_preferences_payload(amount=1))
        changed_issue_payload = {**issue_payload, "priority": 1}
        self.client.patch("/api/issues/priority", json=changed_issue_payload)
        import_response = self.client.post(
            "/api/backups/import",
            json={"path": str(exported_path)},
        )
        if import_response.status_code != HTTP_OK:
            raise AssertionError(import_response.text)

        restored_preferences = self.client.get("/api/preferences").json()
        if (
            restored_preferences["closedIssueHistory"]["amount"]
            != BACKUP_PREFERENCES_AMOUNT
        ):
            message = "Expected the backup to restore preferences."
            raise AssertionError(message)
        with closing(sqlite3.connect(self.settings.issues_database_path)) as connection:
            restored_priority = connection.execute(
                "SELECT priority FROM tracked_issues WHERE issue_key = ?",
                ("example/repo#7",),
            ).fetchone()[0]
        if restored_priority != BACKUP_PRIORITY:
            message = "Expected the backup to restore SQLite local state."
            raise AssertionError(message)
        if not Path(import_response.json()["safetyBackupPath"]).exists():
            message = "Expected an automatic pre-restore safety backup."
            raise AssertionError(message)

    def test_invalid_archive_is_rejected_before_mutation(self) -> None:
        """Reject an invalid file without replacing local preferences."""
        self.client.put(
            "/api/preferences",
            json=_preferences_payload(amount=UNCHANGED_PREFERENCES_AMOUNT),
        )
        invalid_path = Path(self._temporary_directory.name) / "invalid.backup"
        invalid_path.write_text("not a zip", encoding="utf-8")
        response = self.client.post(
            "/api/backups/import",
            json={"path": str(invalid_path)},
        )
        if response.status_code != HTTP_UNPROCESSABLE_ENTITY:
            message = "Expected an invalid backup to be rejected."
            raise AssertionError(message)
        if (
            self.client.get("/api/preferences").json()["closedIssueHistory"]["amount"]
            != UNCHANGED_PREFERENCES_AMOUNT
        ):
            message = "Expected failed import to leave preferences untouched."
            raise AssertionError(message)


class RuntimeSecretIntegrationTests(TestCase):
    """Verify that the embedded API accepts only its paired renderer."""

    def test_runtime_secret_protects_data_routes_but_not_health(self) -> None:
        """Require the ephemeral secret for every non-health request."""
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            settings = AppSettings(
                issues_database_path=root / "issues.db",
                preferences_path=root / "preferences.json",
                runtime_secret="paired-renderer-secret",  # noqa: S106
            )
            with TestClient(
                create_app(settings=settings, github_client=EmptyGitHubClient()),
            ) as client:
                if client.get("/health").status_code != HTTP_OK:
                    message = "Health must stay available to the process supervisor."
                    raise AssertionError(message)
                if client.get("/api/preferences").status_code != HTTP_UNAUTHORIZED:
                    message = "Expected an unpaired renderer to be rejected."
                    raise AssertionError(message)
                authorized = client.get(
                    "/api/preferences",
                    headers={
                        "X-Dashboard-Runtime-Secret": "paired-renderer-secret",
                    },
                )
                if authorized.status_code != HTTP_OK:
                    raise AssertionError(authorized.text)
