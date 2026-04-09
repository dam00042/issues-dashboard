"""Test the public issue routes end to end."""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

from dashboard_api.app.main import create_app
from dashboard_api.domain.issues.defaults import build_issue_key
from dashboard_api.domain.issues.models import GitHubAssignedIssue
from dashboard_api.settings import AppSettings
from dashboard_api.shared.time import subtract_months, utc_now

HTTP_OK = 200
HTTP_UNPROCESSABLE_ENTITY = 422
ALL_VISIBLE_ISSUES = 3
SYNCED_PRIORITY = 4
EXPECTED_SYNCED_BLOCKS = 2
EXPECTED_SYNCED_ITEMS = 1
SYNCED_COMPLETION_PRIORITY = 3
IMMEDIATE_SYNCED_PRIORITY = 3
DEDICATED_PRIORITY = 2
RESTORED_PRIORITY = 4


def _relative_timestamp(months_ago: int) -> str:
    """Build a UTC ISO timestamp relative to now."""
    timestamp = subtract_months(utc_now(), months_ago)
    return timestamp.isoformat(timespec="seconds").replace("+00:00", "Z")


class FakeGitHubAssignedIssuesClient:
    """Provide deterministic issues for integration tests."""

    def __init__(self, issues: tuple[GitHubAssignedIssue, ...]) -> None:
        """Store the issues that the fake gateway should return."""
        self._issues = issues

    def can_refresh(self) -> bool:
        """Pretend that GitHub credentials are configured."""
        return True

    def fetch_assigned_issues(self) -> tuple[GitHubAssignedIssue, ...]:
        """Return the configured fake issues."""
        return self._issues


def _build_issue(
    *,
    github_id: int,
    repository_full_name: str,
    issue_number: int,
    remote_state: str,
    closed_at: str | None,
) -> GitHubAssignedIssue:
    """Build a fake GitHub assigned issue."""
    repository_name = repository_full_name.rsplit("/", maxsplit=1)[-1]
    return GitHubAssignedIssue(
        github_id=github_id,
        repository_full_name=repository_full_name,
        repository_name=repository_name,
        repository_owner_login="octocat",
        repository_owner_avatar_url="https://avatars.githubusercontent.com/u/1?v=4",
        issue_number=issue_number,
        remote_state=remote_state,
        title=f"Issue {issue_number}",
        body_markdown=f"Body for issue {issue_number}",
        html_url=f"https://github.com/{repository_full_name}/issues/{issue_number}",
        created_at=_relative_timestamp(10),
        updated_at=_relative_timestamp(0),
        closed_at=closed_at,
    )


class IssueRoutesIntegrationTests(TestCase):
    """Verify the issue snapshot and sync routes."""

    def setUp(self) -> None:
        """Create a temporary app and test client."""
        self._temp_directory = tempfile.TemporaryDirectory()
        database_path = Path(self._temp_directory.name) / "issues.db"
        configured_settings = {
            "github_token": "ghs_fake",
            "issues_database_path": database_path,
        }
        settings = AppSettings(**configured_settings)
        recent_closed_issue = _build_issue(
            github_id=2,
            repository_full_name="octo/recent",
            issue_number=202,
            remote_state="closed",
            closed_at=_relative_timestamp(1),
        )
        old_closed_issue = _build_issue(
            github_id=3,
            repository_full_name="octo/old",
            issue_number=303,
            remote_state="closed",
            closed_at=_relative_timestamp(8),
        )
        open_issue = _build_issue(
            github_id=1,
            repository_full_name="octo/open",
            issue_number=101,
            remote_state="open",
            closed_at=None,
        )
        fake_client = FakeGitHubAssignedIssuesClient(
            (open_issue, recent_closed_issue, old_closed_issue),
        )
        app = create_app(settings=settings, github_client=fake_client)
        self._client_context = TestClient(app)
        self.client = self._client_context.__enter__()

    def tearDown(self) -> None:
        """Dispose the test client and temporary storage."""
        self._client_context.__exit__(None, None, None)
        self._temp_directory.cleanup()

    def test_snapshot_filters_closed_issues_by_month_window(self) -> None:
        """Return open issues and only recently closed issues by default."""
        response = self.client.get(
            "/api/issues/snapshot",
            params={"closed_window": "3"},
        )

        if response.status_code != HTTP_OK:
            message = "Expected a successful snapshot response."
            raise AssertionError(message)
        payload = response.json()
        returned_issue_keys = [issue["issueKey"] for issue in payload["issues"]]

        if build_issue_key("octo/open", 101) not in returned_issue_keys:
            message = "Expected the open issue to be present in the snapshot."
            raise AssertionError(message)
        if build_issue_key("octo/recent", 202) not in returned_issue_keys:
            message = "Expected the recently closed issue to be present."
            raise AssertionError(message)
        if build_issue_key("octo/old", 303) in returned_issue_keys:
            message = "Did not expect the old closed issue in the snapshot."
            raise AssertionError(message)

    def test_snapshot_can_return_all_closed_issues(self) -> None:
        """Return every assigned issue when the closed filter is set to all."""
        response = self.client.get(
            "/api/issues/snapshot",
            params={"closed_window": "all"},
        )

        if response.status_code != HTTP_OK:
            message = "Expected a successful snapshot response."
            raise AssertionError(message)
        payload = response.json()

        if len(payload["issues"]) != ALL_VISIBLE_ISSUES:
            message = "Expected every issue to be returned for the 'all' filter."
            raise AssertionError(message)

    def test_snapshot_accepts_manual_positive_month_values(self) -> None:
        """Support any positive month count rather than only presets."""
        response = self.client.get(
            "/api/issues/snapshot",
            params={"closed_window": "9"},
        )

        if response.status_code != HTTP_OK:
            message = "Expected a successful response for a manual month value."
            raise AssertionError(message)
        payload = response.json()

        if len(payload["issues"]) != ALL_VISIBLE_ISSUES:
            message = "Expected the custom month filter to include older closures."
            raise AssertionError(message)

    def test_snapshot_rejects_invalid_closed_window_values(self) -> None:
        """Reject non-positive and non-numeric closed-window values."""
        invalid_response = self.client.get(
            "/api/issues/snapshot",
            params={"closed_window": "banana"},
        )
        zero_response = self.client.get(
            "/api/issues/snapshot",
            params={"closed_window": "0"},
        )

        if invalid_response.status_code != HTTP_UNPROCESSABLE_ENTITY:
            message = "Expected non-numeric closed_window values to be rejected."
            raise AssertionError(message)
        if zero_response.status_code != HTTP_UNPROCESSABLE_ENTITY:
            message = "Expected non-positive closed_window values to be rejected."
            raise AssertionError(message)

    def test_sync_state_persists_priority_and_note_blocks(self) -> None:
        """Persist local state changes and expose them on the next snapshot."""
        issue_key = build_issue_key("octo/open", 101)
        sync_payload = {
            "states": [
                {
                    "githubId": 1,
                    "issueKey": issue_key,
                    "issueNumber": 101,
                    "repoFullName": "octo/open",
                    "repoName": "open",
                    "state": {
                        "isPinned": True,
                        "lastPinnedBeforeCompletion": False,
                        "lastPriorityBeforeCompletion": None,
                        "localCompletedAt": None,
                        "lastInteractedAt": _relative_timestamp(0),
                        "noteBlocks": [
                            {
                                "id": "context",
                                "label": "Contexto",
                                "items": [
                                    {
                                        "checked": False,
                                        "id": "item-1",
                                        "kind": "text",
                                        "text": "Revisar el despliegue fallido.",
                                    },
                                ],
                            },
                            {
                                "id": "next-action",
                                "label": "Siguientes pasos",
                                "items": [
                                    {
                                        "checked": True,
                                        "id": "item-1",
                                        "kind": "checklist",
                                        "text": "Confirmar logs",
                                    },
                                ],
                            },
                        ],
                        "priority": 4,
                    },
                },
            ],
        }

        sync_response = self.client.post("/api/issues/sync-state", json=sync_payload)
        snapshot_response = self.client.get(
            "/api/issues/snapshot",
            params={"closed_window": "all"},
        )

        if sync_response.status_code != HTTP_OK:
            message = "Expected the sync endpoint to accept the payload."
            raise AssertionError(message)
        if sync_response.json()["updated"] != 1:
            message = "Expected exactly one state update to be persisted."
            raise AssertionError(message)
        if snapshot_response.status_code != HTTP_OK:
            message = "Expected a successful snapshot response."
            raise AssertionError(message)

        issues_by_key = {
            issue["issueKey"]: issue for issue in snapshot_response.json()["issues"]
        }
        synced_issue = issues_by_key[issue_key]

        if synced_issue["localState"]["priority"] != SYNCED_PRIORITY:
            message = "Expected the synced priority to be persisted."
            raise AssertionError(message)
        if not synced_issue["localState"]["isPinned"]:
            message = "Expected the pinned flag to be persisted."
            raise AssertionError(message)
        if len(synced_issue["localState"]["noteBlocks"]) != EXPECTED_SYNCED_BLOCKS:
            message = "Expected both note blocks to be stored."
            raise AssertionError(message)
        if (
            len(synced_issue["localState"]["noteBlocks"][0]["items"])
            != EXPECTED_SYNCED_ITEMS
        ):
            message = "Expected the note items to be stored."
            raise AssertionError(message)
        if (
            synced_issue["localState"]["noteBlocks"][0]["items"][0]["text"]
            != "Revisar el despliegue fallido."
        ):
            message = "Expected the note item text to be preserved."
            raise AssertionError(message)
        if (
            synced_issue["localState"]["noteBlocks"][1]["items"][0]["kind"]
            != "checklist"
        ):
            message = "Expected the note item kind to be preserved."
            raise AssertionError(message)

    def test_single_state_route_persists_an_immediate_local_update(self) -> None:
        """Persist a single immediate local-state change through the dedicated route."""
        issue_key = build_issue_key("octo/open", 101)
        payload = {
            "githubId": 1,
            "issueKey": issue_key,
            "issueNumber": 101,
            "repoFullName": "octo/open",
            "repoName": "open",
            "state": {
                "isPinned": False,
                "lastPinnedBeforeCompletion": False,
                "lastPriorityBeforeCompletion": None,
                "localCompletedAt": None,
                "lastInteractedAt": _relative_timestamp(0),
                "noteBlocks": [
                    {
                        "id": "context",
                        "label": "Contexto",
                        "items": [
                            {
                                "checked": False,
                                "id": "item-1",
                                "kind": "text",
                                "text": "Validar el despliegue final.",
                            },
                        ],
                    },
                    {
                        "id": "next-action",
                        "label": "Siguientes pasos",
                        "items": [
                            {
                                "checked": True,
                                "id": "item-2",
                                "kind": "checklist",
                                "text": "Cerrar el seguimiento",
                            },
                        ],
                    },
                ],
                "priority": 3,
            },
        }

        sync_response = self.client.post("/api/issues/state", json=payload)
        snapshot_response = self.client.get(
            "/api/issues/snapshot",
            params={"closed_window": "all"},
        )

        if sync_response.status_code != HTTP_OK:
            message = "Expected the dedicated single-state route to accept the payload."
            raise AssertionError(message)
        if snapshot_response.status_code != HTTP_OK:
            message = "Expected a successful snapshot response."
            raise AssertionError(message)

        issues_by_key = {
            issue["issueKey"]: issue for issue in snapshot_response.json()["issues"]
        }
        synced_issue = issues_by_key[issue_key]

        if synced_issue["localState"]["priority"] != IMMEDIATE_SYNCED_PRIORITY:
            message = "Expected the immediate priority change to be persisted."
            raise AssertionError(message)
        if (
            synced_issue["localState"]["noteBlocks"][1]["items"][0]["checked"]
            is not True
        ):
            message = "Expected the checklist state to be preserved."
            raise AssertionError(message)

    def test_sync_state_persists_local_completion_state(self) -> None:
        """Persist local completion metadata for completed issues."""
        issue_key = build_issue_key("octo/open", 101)
        completed_at = _relative_timestamp(0)
        sync_payload = {
            "states": [
                {
                    "githubId": 1,
                    "issueKey": issue_key,
                    "issueNumber": 101,
                    "repoFullName": "octo/open",
                    "repoName": "open",
                    "state": {
                        "isPinned": False,
                        "lastPinnedBeforeCompletion": True,
                        "lastPriorityBeforeCompletion": SYNCED_COMPLETION_PRIORITY,
                        "localCompletedAt": completed_at,
                        "lastInteractedAt": completed_at,
                        "noteBlocks": [
                            {
                                "id": "context",
                                "label": "Contexto",
                                "items": [
                                    {
                                        "checked": False,
                                        "id": "item-1",
                                        "kind": "text",
                                        "text": "",
                                    },
                                ],
                            },
                            {
                                "id": "next-action",
                                "label": "Siguientes pasos",
                                "items": [
                                    {
                                        "checked": False,
                                        "id": "item-2",
                                        "kind": "text",
                                        "text": "",
                                    },
                                ],
                            },
                        ],
                        "priority": None,
                    },
                },
            ],
        }

        sync_response = self.client.post("/api/issues/sync-state", json=sync_payload)
        snapshot_response = self.client.get(
            "/api/issues/snapshot",
            params={"closed_window": "all"},
        )

        if sync_response.status_code != HTTP_OK:
            message = "Expected the completion sync payload to be accepted."
            raise AssertionError(message)
        if snapshot_response.status_code != HTTP_OK:
            message = "Expected a successful snapshot response."
            raise AssertionError(message)

        issues_by_key = {
            issue["issueKey"]: issue for issue in snapshot_response.json()["issues"]
        }
        synced_issue = issues_by_key[issue_key]

        if synced_issue["localState"]["localCompletedAt"] != completed_at:
            message = "Expected the local completion timestamp to be persisted."
            raise AssertionError(message)
        if synced_issue["localState"]["priority"] is not None:
            message = "Expected completed issues to keep a null active priority."
            raise AssertionError(message)
        if (
            synced_issue["localState"]["lastPriorityBeforeCompletion"]
            != SYNCED_COMPLETION_PRIORITY
        ):
            message = "Expected the previous priority to be persisted."
            raise AssertionError(message)
        if not synced_issue["localState"]["lastPinnedBeforeCompletion"]:
            message = "Expected the previous pin state to be persisted."
            raise AssertionError(message)

    def test_priority_and_pin_routes_persist_targeted_mutations(self) -> None:
        """Persist priority and pin changes through their dedicated routes."""
        issue_key = build_issue_key("octo/open", 101)
        priority_response = self.client.patch(
            "/api/issues/priority",
            json={
                "githubId": 1,
                "issueKey": issue_key,
                "issueNumber": 101,
                "priority": DEDICATED_PRIORITY,
                "repoFullName": "octo/open",
                "repoName": "open",
            },
        )
        pin_response = self.client.patch(
            "/api/issues/pin",
            json={
                "githubId": 1,
                "isPinned": True,
                "issueKey": issue_key,
                "issueNumber": 101,
                "repoFullName": "octo/open",
                "repoName": "open",
            },
        )
        snapshot_response = self.client.get(
            "/api/issues/snapshot",
            params={"closed_window": "all"},
        )

        if priority_response.status_code != HTTP_OK:
            message = "Expected the dedicated priority route to accept the payload."
            raise AssertionError(message)
        if pin_response.status_code != HTTP_OK:
            message = "Expected the dedicated pin route to accept the payload."
            raise AssertionError(message)
        if snapshot_response.status_code != HTTP_OK:
            message = "Expected a successful snapshot response."
            raise AssertionError(message)

        issues_by_key = {
            issue["issueKey"]: issue for issue in snapshot_response.json()["issues"]
        }
        synced_issue = issues_by_key[issue_key]

        if synced_issue["localState"]["priority"] != DEDICATED_PRIORITY:
            message = "Expected the dedicated priority route to persist the value."
            raise AssertionError(message)
        if synced_issue["localState"]["isPinned"] is not True:
            message = "Expected the dedicated pin route to persist the flag."
            raise AssertionError(message)

    def test_completion_route_restores_previous_priority_and_pin_state(self) -> None:
        """Persist completion and restore mutations through the dedicated route."""
        issue_key = build_issue_key("octo/open", 101)
        self.client.patch(
            "/api/issues/priority",
            json={
                "githubId": 1,
                "issueKey": issue_key,
                "issueNumber": 101,
                "priority": RESTORED_PRIORITY,
                "repoFullName": "octo/open",
                "repoName": "open",
            },
        )
        self.client.patch(
            "/api/issues/pin",
            json={
                "githubId": 1,
                "isPinned": True,
                "issueKey": issue_key,
                "issueNumber": 101,
                "repoFullName": "octo/open",
                "repoName": "open",
            },
        )

        complete_response = self.client.put(
            "/api/issues/completion",
            json={
                "githubId": 1,
                "isCompleted": True,
                "issueKey": issue_key,
                "issueNumber": 101,
                "repoFullName": "octo/open",
                "repoName": "open",
                "state": {
                    "isPinned": False,
                    "lastPinnedBeforeCompletion": True,
                    "lastPriorityBeforeCompletion": RESTORED_PRIORITY,
                    "localCompletedAt": _relative_timestamp(0),
                    "lastInteractedAt": _relative_timestamp(0),
                    "noteBlocks": [],
                    "priority": None,
                },
            },
        )
        restore_response = self.client.put(
            "/api/issues/completion",
            json={
                "githubId": 1,
                "isCompleted": False,
                "issueKey": issue_key,
                "issueNumber": 101,
                "repoFullName": "octo/open",
                "repoName": "open",
                "state": {
                    "isPinned": True,
                    "lastPinnedBeforeCompletion": False,
                    "lastPriorityBeforeCompletion": None,
                    "localCompletedAt": None,
                    "lastInteractedAt": _relative_timestamp(0),
                    "noteBlocks": [],
                    "priority": RESTORED_PRIORITY,
                },
            },
        )
        snapshot_response = self.client.get(
            "/api/issues/snapshot",
            params={"closed_window": "all"},
        )

        if complete_response.status_code != HTTP_OK:
            message = "Expected the dedicated completion route to complete the issue."
            raise AssertionError(message)
        if restore_response.status_code != HTTP_OK:
            message = "Expected the dedicated completion route to restore the issue."
            raise AssertionError(message)
        if snapshot_response.status_code != HTTP_OK:
            message = "Expected a successful snapshot response."
            raise AssertionError(message)

        issues_by_key = {
            issue["issueKey"]: issue for issue in snapshot_response.json()["issues"]
        }
        synced_issue = issues_by_key[issue_key]

        if synced_issue["localState"]["localCompletedAt"] is not None:
            message = "Expected the issue to be restored after the second mutation."
            raise AssertionError(message)
        if synced_issue["localState"]["priority"] != RESTORED_PRIORITY:
            message = "Expected the previous priority to be restored."
            raise AssertionError(message)
        if synced_issue["localState"]["isPinned"] is not True:
            message = "Expected the previous pin state to be restored."
            raise AssertionError(message)

    def test_notes_route_persists_note_blocks_without_full_state_payload(self) -> None:
        """Persist notes through the dedicated route without sending the full state."""
        issue_key = build_issue_key("octo/open", 101)
        notes_response = self.client.put(
            "/api/issues/notes",
            json={
                "githubId": 1,
                "issueKey": issue_key,
                "issueNumber": 101,
                "lastInteractedAt": _relative_timestamp(0),
                "noteBlocks": [
                    {
                        "id": "context",
                        "label": "Contexto",
                        "items": [
                            {
                                "checked": False,
                                "id": "context-item-1",
                                "kind": "text",
                                "text": "Analizar el timeout del backend.",
                            },
                        ],
                    },
                    {
                        "id": "next-action",
                        "label": "Siguientes pasos",
                        "items": [
                            {
                                "checked": True,
                                "id": "next-action-item-1",
                                "kind": "checklist",
                                "text": "Revisar la traza de Electron",
                            },
                        ],
                    },
                ],
                "repoFullName": "octo/open",
                "repoName": "open",
            },
        )
        snapshot_response = self.client.get(
            "/api/issues/snapshot",
            params={"closed_window": "all"},
        )

        if notes_response.status_code != HTTP_OK:
            message = "Expected the dedicated notes route to accept the payload."
            raise AssertionError(message)
        if snapshot_response.status_code != HTTP_OK:
            message = "Expected a successful snapshot response."
            raise AssertionError(message)

        issues_by_key = {
            issue["issueKey"]: issue for issue in snapshot_response.json()["issues"]
        }
        synced_issue = issues_by_key[issue_key]

        if (
            synced_issue["localState"]["noteBlocks"][0]["items"][0]["text"]
            != "Analizar el timeout del backend."
        ):
            message = "Expected the dedicated notes route to persist block text."
            raise AssertionError(message)
        if (
            synced_issue["localState"]["noteBlocks"][1]["items"][0]["checked"]
            is not True
        ):
            message = "Expected the dedicated notes route to persist checklist state."
            raise AssertionError(message)
