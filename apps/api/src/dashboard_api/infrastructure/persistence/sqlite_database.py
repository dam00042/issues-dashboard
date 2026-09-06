"""Provide SQLite connections, migrations, integrity checks and snapshots."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import TYPE_CHECKING

from dashboard_api.shared.time import utc_now_iso

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator
    from pathlib import Path

CURRENT_SCHEMA_VERSION = 2

CREATE_MIGRATIONS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
)
"""


def _migration_1(connection: sqlite3.Connection) -> None:
    """Record the original tracked-issues schema as the baseline."""
    connection.execute(CREATE_MIGRATIONS_TABLE_SQL)


def _migration_2(connection: sqlite3.Connection) -> None:
    """Add normalized Projects and Pull Request relationship projections."""
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS issue_project_values (
            issue_key TEXT NOT NULL,
            project_id TEXT NOT NULL,
            project_number INTEGER NOT NULL DEFAULT 0,
            project_title TEXT NOT NULL,
            project_url TEXT NOT NULL DEFAULT '',
            field_id TEXT NOT NULL,
            field_name TEXT NOT NULL,
            normalized_field_name TEXT NOT NULL,
            field_kind TEXT NOT NULL,
            field_value TEXT NOT NULL,
            PRIMARY KEY (issue_key, project_id, field_id, field_value),
            FOREIGN KEY (issue_key) REFERENCES tracked_issues(issue_key)
                ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_issue_project_values_filter
        ON issue_project_values (
            normalized_field_name,
            field_value,
            issue_key
        );

        CREATE TABLE IF NOT EXISTS issue_pull_requests (
            issue_key TEXT NOT NULL,
            pull_request_node_id TEXT NOT NULL,
            PRIMARY KEY (issue_key, pull_request_node_id),
            FOREIGN KEY (issue_key) REFERENCES tracked_issues(issue_key)
                ON DELETE CASCADE,
            FOREIGN KEY (pull_request_node_id) REFERENCES pull_requests(node_id)
                ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_issue_pull_requests_pr
        ON issue_pull_requests (pull_request_node_id, issue_key);

        CREATE TABLE IF NOT EXISTS pull_request_reviewers (
            pull_request_node_id TEXT NOT NULL,
            reviewer_login TEXT NOT NULL,
            PRIMARY KEY (pull_request_node_id, reviewer_login),
            FOREIGN KEY (pull_request_node_id) REFERENCES pull_requests(node_id)
                ON DELETE CASCADE
        );
        """,
    )


MIGRATIONS: tuple[tuple[int, Callable[[sqlite3.Connection], None]], ...] = (
    (1, _migration_1),
    (2, _migration_2),
)


class SqliteDatabase:
    """Own low-level SQLite behavior shared by all repositories."""

    def __init__(self, database_path: Path) -> None:
        """Store the absolute database path."""
        self.path = database_path

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        """Open a short-lived connection configured for local desktop use."""
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 5000")
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA synchronous = NORMAL")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def migrate(self) -> None:
        """Apply every pending, ordered schema migration exactly once."""
        with self.connect() as connection:
            connection.execute(CREATE_MIGRATIONS_TABLE_SQL)
            current_version = int(
                connection.execute("PRAGMA user_version").fetchone()[0],
            )
            if current_version > CURRENT_SCHEMA_VERSION:
                message = (
                    "La base de datos pertenece a una versión más reciente "
                    "de Issues Dashboard."
                )
                raise RuntimeError(message)

            for version, migration in MIGRATIONS:
                if version <= current_version:
                    continue
                migration(connection)
                connection.execute(
                    "INSERT OR REPLACE INTO schema_migrations "
                    "(version, applied_at) VALUES (?, ?)",
                    (version, utc_now_iso()),
                )
                connection.execute(f"PRAGMA user_version = {version}")

    def schema_version(self) -> int:
        """Return the schema version stored in the database header."""
        with self.connect() as connection:
            return int(connection.execute("PRAGMA user_version").fetchone()[0])

    def quick_check(self) -> None:
        """Raise when SQLite reports structural corruption."""
        with self.connect() as connection:
            result = connection.execute("PRAGMA quick_check").fetchone()
        if result is None or str(result[0]).lower() != "ok":
            message = "SQLite no ha superado la comprobación de integridad."
            raise RuntimeError(message)

    def checkpoint(self) -> None:
        """Move committed WAL pages into the main database file."""
        with self.connect() as connection:
            connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()

    def backup_to(self, destination_path: Path) -> None:
        """Create a consistent online backup that includes WAL changes."""
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        source = sqlite3.connect(self.path, timeout=5)
        destination = sqlite3.connect(destination_path)
        try:
            source.execute("PRAGMA busy_timeout = 5000")
            source.backup(destination)
            result = destination.execute("PRAGMA quick_check").fetchone()
            if result is None or str(result[0]).lower() != "ok":
                message = "La instantánea SQLite exportada no es íntegra."
                raise RuntimeError(message)
        finally:
            destination.close()
            source.close()


__all__ = ["CURRENT_SCHEMA_VERSION", "SqliteDatabase"]
