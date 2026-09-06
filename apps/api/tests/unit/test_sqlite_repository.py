"""Test SQLite migrations and compatibility backfills."""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest import TestCase

from dashboard_api.domain.issues.models import (
    GitHubAssignedIssue,
    GitHubProjectFieldValue,
    GitHubProjectItem,
    GitHubPullRequest,
)
from dashboard_api.infrastructure.persistence.sqlite_repository import (
    SqliteTrackedIssueRepository,
)


class SqliteTrackedIssueRepositoryTests(TestCase):
    """Verify upgrades preserve and normalize existing cached data."""

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
