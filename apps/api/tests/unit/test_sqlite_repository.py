"""Test SQLite migrations and compatibility backfills."""

from __future__ import annotations

import sqlite3
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from threading import Event
from unittest import TestCase

import pytest

from dashboard_api.issues.defaults import default_local_state
from dashboard_api.issues.models import (
    GitHubAssignedIssue,
    GitHubProjectFieldValue,
    GitHubProjectItem,
    GitHubPullRequest,
    IssueLocalState,
    IssueLocalStateChange,
    IssueLocalStateTarget,
    NoteBlock,
    NoteBlockItem,
)
from dashboard_api.issues.service import IssueLocalStateCommandService
from dashboard_api.persistence.sqlite_database import MIGRATIONS
from dashboard_api.persistence.sqlite_repository import (
    CREATE_TRACKED_ISSUES_TABLE_SQL,
    SqliteTrackedIssueRepository,
)


class SqliteTrackedIssueRepositoryTests(TestCase):
    """Verify upgrades preserve and normalize existing cached data."""

    def test_migrates_workflow_status_without_changing_existing_local_data(
        self,
    ) -> None:
        """Infer legacy completion state while retaining notes and priorities."""
        with tempfile.TemporaryDirectory() as temporary_directory:
            repository = SqliteTrackedIssueRepository(
                Path(temporary_directory) / "issues.db",
            )
            with repository.database.connect() as connection:
                connection.execute(CREATE_TRACKED_ISSUES_TABLE_SQL)
                for _version, migration in MIGRATIONS[:2]:
                    migration(connection)
                connection.execute("PRAGMA user_version = 2")
                connection.executemany(
                    "INSERT INTO tracked_issues (issue_key, github_id, repo_full_name, "
                    "repo_name, issue_number, remote_state, priority, "
                    "local_completed_at, note_blocks_json, first_seen_at, synced_at) "
                    "VALUES (?, 1, 'octo/repo', 'repo', 1, 'open', 2, ?, ?, ?, ?)",
                    (
                        (
                            issue_key,
                            completed_at,
                            '[{"id":"context","label":"Contexto","items":'
                            '[{"id":"saved","kind":"text","text":"Keep me"}]}]',
                            "2026-01-01T00:00:00Z",
                            "2026-01-01T00:00:00Z",
                        )
                        for issue_key, completed_at in (
                            ("octo/repo#1", None),
                            ("octo/repo#2", "2026-01-02T00:00:00Z"),
                        )
                    ),
                )
            repository.initialize_schema()
            repository.initialize_schema()
            for issue_key, expected_status in (
                ("octo/repo#1", "active"),
                ("octo/repo#2", "completed"),
            ):
                issue = repository.get_tracked_issue(issue_key)
                if issue is None or issue.local_state.status != expected_status:
                    raise AssertionError(issue)
                if issue.local_state.priority != 2:  # noqa: PLR2004
                    raise AssertionError(issue.local_state)
                if issue.local_state.note_blocks[0].items[0].text != "Keep me":
                    raise AssertionError(issue.local_state.note_blocks)

    def test_failed_workflow_migration_rolls_back_and_can_be_retried(self) -> None:
        """Leave every supported legacy schema intact if the upgrade fails."""
        for schema_version in range(3):
            with self.subTest(schema_version=schema_version):
                self._verify_failed_workflow_migration(schema_version)

    def _verify_failed_workflow_migration(self, schema_version: int) -> None:
        """Check a failed migration from one version, then retry successfully."""
        with tempfile.TemporaryDirectory() as temporary_directory:
            repository = SqliteTrackedIssueRepository(
                Path(temporary_directory) / "issues.db",
            )
            with repository.database.connect() as connection:
                connection.execute(CREATE_TRACKED_ISSUES_TABLE_SQL)
                for _version, migration in MIGRATIONS[:schema_version]:
                    migration(connection)
                connection.execute(f"PRAGMA user_version = {schema_version}")
                connection.execute(
                    "INSERT INTO tracked_issues (issue_key, github_id, repo_full_name, "
                    "repo_name, issue_number, remote_state, local_completed_at, "
                    "note_blocks_json, first_seen_at, synced_at) VALUES "
                    "('octo/repo#1', 1, 'octo/repo', 'repo', 1, 'open', "
                    "'2026-01-02T00:00:00Z', '[]', '', '')",
                )
                connection.execute(
                    "CREATE TRIGGER simulate_write_failure "
                    "BEFORE UPDATE ON tracked_issues BEGIN "
                    "SELECT RAISE(ABORT, 'Simulated write failure'); END",
                )
            with pytest.raises(sqlite3.IntegrityError, match="Simulated write failure"):
                repository.database.migrate()

            with repository.database.connect() as connection:
                columns = {
                    row["name"]
                    for row in connection.execute("PRAGMA table_info(tracked_issues)")
                }
                if "local_status" in columns:
                    message = "A failed migration must not leave the new column behind."
                    raise AssertionError(message)
                if repository.database.schema_version() != schema_version:
                    message = "A failed migration must not advance the schema version."
                    raise AssertionError(message)
                completed_at = connection.execute(
                    "SELECT local_completed_at FROM tracked_issues",
                ).fetchone()[0]
                if completed_at != "2026-01-02T00:00:00Z":
                    raise AssertionError(completed_at)
                connection.execute("DROP TRIGGER simulate_write_failure")

            repository.database.migrate()
            issue = repository.get_tracked_issue("octo/repo#1")
            if issue is None or issue.local_state.status != "completed":
                raise AssertionError(issue)

    def test_concurrent_commands_preserve_notes_and_allow_cache_reads(self) -> None:
        """Serialize independent writers while cached reads stay available."""
        with tempfile.TemporaryDirectory() as temporary_directory:
            database_path = Path(temporary_directory) / "issues.db"
            repository = SqliteTrackedIssueRepository(database_path)
            repository.initialize_schema()
            target = IssueLocalStateTarget(
                issue_key="octo/repo#1",
                github_id=1,
                repository_full_name="octo/repo",
                repository_name="repo",
                issue_number=1,
            )
            repository.upsert_local_states(
                (
                    IssueLocalStateChange(
                        issue_key=target.issue_key,
                        github_id=target.github_id,
                        repository_full_name=target.repository_full_name,
                        repository_name=target.repository_name,
                        issue_number=target.issue_number,
                        state=default_local_state(),
                    ),
                ),
            )
            state_read = Event()
            release_writer = Event()
            second_started = Event()

            def update_notes(current: IssueLocalState) -> IssueLocalState:
                state_read.set()
                if not release_writer.wait(timeout=5):
                    message = "The first local command was not released."
                    raise AssertionError(message)
                return replace(
                    current,
                    status="in_review",
                    note_blocks=(
                        NoteBlock(
                            id="context",
                            label="Contexto",
                            items=(
                                NoteBlockItem(id="saved", kind="text", text="Keep"),
                            ),
                        ),
                    ),
                )

            def update_priority() -> int:
                second_started.set()
                return IssueLocalStateCommandService(
                    SqliteTrackedIssueRepository(database_path),
                ).set_priority(target, 2)

            with ThreadPoolExecutor(max_workers=2) as executor:
                notes_write = executor.submit(
                    repository.update_local_state,
                    target,
                    update_notes,
                )
                try:
                    if not state_read.wait(timeout=5):
                        message = "The first local command did not read its state."
                        raise AssertionError(message)
                    priority_write = executor.submit(update_priority)
                    if not second_started.wait(timeout=5):
                        message = "The second local command did not start."
                        raise AssertionError(message)
                    cached = repository.get_tracked_issue(target.issue_key)
                    if cached is None or cached.local_state.status != "active":
                        raise AssertionError(cached)
                finally:
                    release_writer.set()
                notes_write.result(timeout=5)
                priority_write.result(timeout=5)

            restarted = SqliteTrackedIssueRepository(database_path)
            restarted.initialize_schema()
            issue = restarted.get_tracked_issue(target.issue_key)
            if issue is None or issue.local_state.status != "in_review":
                raise AssertionError(issue)
            if issue.local_state.priority != 2:  # noqa: PLR2004
                raise AssertionError(issue.local_state)
            if issue.local_state.note_blocks[0].items[0].text != "Keep":
                raise AssertionError(issue.local_state.note_blocks)

    def test_backfills_normalized_tables_from_legacy_json_once(self) -> None:
        """Make upgraded databases immediately queryable without GitHub."""
        with tempfile.TemporaryDirectory() as temporary_directory:
            database_path = Path(temporary_directory) / "issues.db"
            repository = SqliteTrackedIssueRepository(database_path)
            repository.initialize_schema()

            pull_request = GitHubPullRequest(
                node_id="PR_NODE_7",
                repository_full_name="octo/dashboard",
                number=7,
                title="Normalize storage",
                html_url="https://github.com/octo/dashboard/pull/7",
                state="open",
                is_draft=False,
                author_login="author",
                reviewer_logins=("reviewer",),
                updated_at="2026-08-03T10:00:00Z",
            )
            issue = GitHubAssignedIssue(
                github_id=42,
                repository_full_name="octo/dashboard",
                repository_name="dashboard",
                repository_owner_login="octo",
                repository_owner_avatar_url="https://example.test/avatar",
                issue_number=42,
                remote_state="open",
                title="Normalize storage",
                body_markdown="Existing cached content",
                html_url="https://github.com/octo/dashboard/issues/42",
                created_at="2026-08-01T10:00:00Z",
                updated_at="2026-08-02T10:00:00Z",
                closed_at=None,
                project_items=(
                    GitHubProjectItem(
                        project_id="PROJECT_1",
                        project_number=1,
                        project_title="Roadmap",
                        project_url="https://github.com/orgs/octo/projects/1",
                        fields=(
                            GitHubProjectFieldValue(
                                field_id="STATUS",
                                field_name="Status",
                                kind="single_select",
                                value="In Review",
                            ),
                        ),
                        linked_pull_requests=(pull_request,),
                    ),
                ),
            )
            repository.replace_remote_projection((issue,))
            repository.replace_pull_requests((pull_request,))

            with repository.database.connect() as connection:
                connection.execute("DELETE FROM issue_project_values")
                connection.execute("DELETE FROM issue_pull_requests")
                connection.execute("DELETE FROM pull_request_reviewers")
                connection.execute(
                    "DELETE FROM dashboard_metadata "
                    "WHERE metadata_key = 'normalized_projections_backfilled_v2'",
                )

            repository.initialize_schema()
            repository.initialize_schema()

            with repository.database.connect() as connection:
                project_count = connection.execute(
                    "SELECT COUNT(*) FROM issue_project_values",
                ).fetchone()[0]
                relationship_count = connection.execute(
                    "SELECT COUNT(*) FROM issue_pull_requests",
                ).fetchone()[0]
                reviewer_count = connection.execute(
                    "SELECT COUNT(*) FROM pull_request_reviewers",
                ).fetchone()[0]

            if project_count != 1:
                raise AssertionError(project_count)
            if relationship_count != 1:
                raise AssertionError(relationship_count)
            if reviewer_count != 1:
                raise AssertionError(reviewer_count)
