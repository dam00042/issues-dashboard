"""Test cached GitHub Pull Request activity end to end."""

from __future__ import annotations

import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

from dashboard_api.app.main import create_app
from dashboard_api.application.issues.service import (
    AssignedIssuesFetchResult,
    PullRequestFetchResult,
)
from dashboard_api.domain.issues.models import (
    ClosedIssueWindow,
    GitHubPullRequest,
    PullRequestWindow,
)
from dashboard_api.settings import AppSettings
from dashboard_api.shared.time import utc_now_iso

HTTP_OK = 200
HTTP_UNPROCESSABLE_ENTITY = 422


class FakeGitHubActivityClient:
    """Provide deterministic GitHub activity for route tests."""

    def __init__(self, *, can_refresh: bool = True) -> None:
        """Store whether the fake can perform remote refreshes."""
        self.refresh_enabled = can_refresh
        self.pull_request_calls: list[tuple[PullRequestWindow, bool]] = []

    def can_refresh(self) -> bool:
        """Return the configured refresh capability."""
        return self.refresh_enabled

    def fetch_assigned_issues(
        self,
        _closed_window: ClosedIssueWindow | None,
    ) -> AssignedIssuesFetchResult:
        """Return an empty issue feed when required by the app."""
        return AssignedIssuesFetchResult(issues=())

    def fetch_pull_requests(
        self,
        window: PullRequestWindow,
        *,
        force: bool = False,
    ) -> PullRequestFetchResult:
        """Return one structured Pull Request and record the requested window."""
        self.pull_request_calls.append((window, force))
        return PullRequestFetchResult(
            pull_requests=(
                GitHubPullRequest(
                    node_id="PR_TEST_1",
                    repository_full_name="example/repo",
                    number=17,
                    title="Persist this Pull Request",
                    html_url="https://github.com/example/repo/pull/17",
                    state="open",
                    is_draft=False,
                    author_login="octocat",
                    updated_at=utc_now_iso(),
                    reviewer_logins=("assigned-reviewer",),
                    review_decision="review_required",
                    viewer_role="authored",
                    comments_count=3,
                ),
            ),
        )


class GitHubActivityRoutesIntegrationTests(TestCase):
    """Verify bounded refreshes and the persistent Pull Request projection."""

    def setUp(self) -> None:
        """Create an isolated database and API client."""
        self._temp_directory = tempfile.TemporaryDirectory()
        base_path = Path(self._temp_directory.name)
        self.database_path = base_path / "issues.db"
        self.settings = AppSettings(
            github_session_key_path=base_path / "session.key",
            github_session_path=base_path / "session.json",
            issues_database_path=self.database_path,
        )
        self.fake_client = FakeGitHubActivityClient()
        app = create_app(settings=self.settings, github_client=self.fake_client)
        self._client_context = TestClient(app)
        self.client = self._client_context.__enter__()

    def tearDown(self) -> None:
        """Dispose the API client and temporary storage."""
        self._client_context.__exit__(None, None, None)
        self._temp_directory.cleanup()

    def test_loads_cache_first_and_persists_successful_refreshes(  # noqa: C901
        self,
    ) -> None:
        """Return cached data instantly and retain refreshed rows across restarts."""
        cached_response = self.client.get(
            "/api/github/pull-requests",
            params={"window": "1m"},
        )
        if cached_response.status_code != HTTP_OK:
            raise AssertionError(cached_response.text)
        if cached_response.json()["pullRequests"]:
            message = "Expected the initial persistent cache to be empty."
            raise AssertionError(message)
        if self.fake_client.pull_request_calls:
            message = "A cache-only request must not contact GitHub."
            raise AssertionError(message)

        live_response = self.client.get(
            "/api/github/pull-requests",
            params={"window": "1m", "refresh": "true"},
        )
        if live_response.status_code != HTTP_OK:
            raise AssertionError(live_response.text)
        live_payload = live_response.json()
        if live_payload["source"] != "live" or live_payload["refreshedAt"] is None:
            message = "Expected metadata for a successful live refresh."
            raise AssertionError(message)
        if live_payload["pullRequests"][0]["reviewDecision"] != "review_required":
            message = "Expected structured Pull Request review data."
            raise AssertionError(message)
        if live_payload["pullRequests"][0]["reviewerLogins"] != [
            "assigned-reviewer",
        ]:
            message = "Expected assigned Pull Request reviewers in the response."
            raise AssertionError(message)
        expected_window = PullRequestWindow(amount=1, unit="months")
        if self.fake_client.pull_request_calls != [(expected_window, True)]:
            message = "Expected one forced GitHub refresh for the selected window."
            raise AssertionError(message)

        with closing(sqlite3.connect(self.database_path)) as connection:
            columns = {
                row[1]
                for row in connection.execute(
                    "PRAGMA table_info(pull_requests)",
                ).fetchall()
            }
        expected_columns = {
            "node_id",
            "remote_state",
            "review_decision",
            "reviewer_logins_json",
            "viewer_role",
            "comments_count",
            "updated_at",
        }
        if not expected_columns.issubset(columns):
            message = "Expected a structured Pull Request table in SQLite."
            raise AssertionError(message)

        self._client_context.__exit__(None, None, None)
        cached_app = create_app(
            settings=self.settings,
            github_client=FakeGitHubActivityClient(can_refresh=False),
        )
        self._client_context = TestClient(cached_app)
        self.client = self._client_context.__enter__()

        persisted_response = self.client.get(
            "/api/github/pull-requests",
            params={"window": "1m"},
        )
        persisted_payload = persisted_response.json()
        if persisted_payload["source"] != "cache":
            message = "Expected persisted Pull Requests to be served from cache."
            raise AssertionError(message)
        if persisted_payload["pullRequests"][0]["nodeId"] != "PR_TEST_1":
            message = "Expected the Pull Request to survive an API restart."
            raise AssertionError(message)
        if persisted_payload["pullRequests"][0]["reviewerLogins"] != [
            "assigned-reviewer",
        ]:
            message = "Expected reviewers to survive an API restart."
            raise AssertionError(message)

    def test_rejects_invalid_pull_request_windows(self) -> None:
        """Reject invalid history windows without contacting GitHub."""
        response = self.client.get(
            "/api/github/pull-requests",
            params={"window": "all", "refresh": "true"},
        )
        if response.status_code != HTTP_UNPROCESSABLE_ENTITY:
            message = "Expected an invalid PR window to be rejected."
            raise AssertionError(message)
        if self.fake_client.pull_request_calls:
            message = "Invalid windows must not contact GitHub."
            raise AssertionError(message)
