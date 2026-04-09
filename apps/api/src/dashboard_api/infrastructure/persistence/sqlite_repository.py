"""Persist tracked issues in SQLite."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Mapping
from contextlib import contextmanager
from typing import TYPE_CHECKING, cast

from dashboard_api.domain.issues.defaults import (
    build_issue_key,
    default_local_state,
    default_note_blocks,
)
from dashboard_api.domain.issues.models import (
    GitHubAssignedIssue,
    IssueLocalState,
    IssueLocalStateChange,
    NoteBlock,
    NoteBlockItem,
    NoteBlockKind,
    PriorityValue,
    RemoteIssueState,
    TrackedIssue,
)
from dashboard_api.shared.time import (
    subtract_months,
    utc_now,
    utc_now_iso,
)

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path


SQLITE_TRUE = 1
SQLITE_FALSE = 0
VALID_NOTE_BLOCK_KINDS = frozenset({"text", "checklist", "ordered"})

CREATE_TRACKED_ISSUES_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS tracked_issues (
    issue_key TEXT PRIMARY KEY,
    github_id INTEGER NOT NULL,
    repo_full_name TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    repo_owner_login TEXT NOT NULL DEFAULT '',
    repo_owner_avatar_url TEXT NOT NULL DEFAULT '',
    issue_number INTEGER NOT NULL,
    remote_state TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    body_markdown TEXT NOT NULL DEFAULT '',
    html_url TEXT NOT NULL DEFAULT '',
    created_at TEXT,
    updated_at TEXT,
    closed_at TEXT,
    is_assigned INTEGER NOT NULL DEFAULT 1,
    priority INTEGER,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    local_completed_at TEXT,
    last_priority_before_completion INTEGER,
    last_pinned_before_completion INTEGER NOT NULL DEFAULT 0,
    note_blocks_json TEXT NOT NULL,
    last_interacted_at TEXT,
    first_seen_at TEXT NOT NULL,
    synced_at TEXT NOT NULL
)
"""

CREATE_ASSIGNED_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_tracked_issues_assigned
ON tracked_issues (is_assigned, remote_state, updated_at)
"""

CREATE_REPOSITORY_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_tracked_issues_repository
ON tracked_issues (repo_full_name, issue_number)
"""

UPSERT_REMOTE_ISSUE_SQL = """
INSERT INTO tracked_issues (
    issue_key,
    github_id,
    repo_full_name,
    repo_name,
    repo_owner_login,
    repo_owner_avatar_url,
    issue_number,
    remote_state,
    title,
    body_markdown,
    html_url,
    created_at,
    updated_at,
    closed_at,
    is_assigned,
    note_blocks_json,
    first_seen_at,
    synced_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(issue_key) DO UPDATE SET
    github_id = excluded.github_id,
    repo_full_name = excluded.repo_full_name,
    repo_name = excluded.repo_name,
    repo_owner_login = excluded.repo_owner_login,
    repo_owner_avatar_url = excluded.repo_owner_avatar_url,
    issue_number = excluded.issue_number,
    remote_state = excluded.remote_state,
    title = excluded.title,
    body_markdown = excluded.body_markdown,
    html_url = excluded.html_url,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    closed_at = excluded.closed_at,
    is_assigned = excluded.is_assigned,
    synced_at = excluded.synced_at
"""

INSERT_MISSING_TRACKED_ISSUE_SQL = """
INSERT INTO tracked_issues (
    issue_key,
    github_id,
    repo_full_name,
    repo_name,
    issue_number,
    remote_state,
    html_url,
    is_assigned,
    priority,
    is_pinned,
    local_completed_at,
    last_priority_before_completion,
    last_pinned_before_completion,
    note_blocks_json,
    last_interacted_at,
    first_seen_at,
    synced_at
) VALUES (?, ?, ?, ?, ?, 'open', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(issue_key) DO NOTHING
"""

UPDATE_LOCAL_STATE_SQL = """
UPDATE tracked_issues
SET
    priority = ?,
    is_pinned = ?,
    local_completed_at = ?,
    last_priority_before_completion = ?,
    last_pinned_before_completion = ?,
    note_blocks_json = ?,
    last_interacted_at = ?,
    synced_at = ?
WHERE issue_key = ?
"""

LIST_VISIBLE_ISSUES_SQL = """
SELECT *
FROM tracked_issues
WHERE is_assigned = 1
ORDER BY COALESCE(updated_at, created_at, synced_at) DESC, issue_key ASC
"""

LIST_VISIBLE_RECENTLY_CLOSED_ISSUES_SQL = """
SELECT *
FROM tracked_issues
WHERE
    is_assigned = 1
    AND (
        remote_state = 'open'
        OR (remote_state = 'closed' AND closed_at IS NOT NULL AND closed_at >= ?)
    )
ORDER BY COALESCE(updated_at, created_at, synced_at) DESC, issue_key ASC
"""

GET_TRACKED_ISSUE_BY_KEY_SQL = """
SELECT *
FROM tracked_issues
WHERE issue_key = ?
LIMIT 1
"""

DELETE_UNASSIGNED_DEFAULT_ROWS_SQL = """
DELETE FROM tracked_issues
WHERE
    is_assigned = 0
    AND priority IS NULL
    AND is_pinned = 0
    AND local_completed_at IS NULL
    AND last_priority_before_completion IS NULL
    AND last_pinned_before_completion = 0
    AND note_blocks_json = ?
    AND (last_interacted_at IS NULL OR last_interacted_at = '')
"""


def _as_mapping(value: object) -> Mapping[str, object] | None:
    """Return a typed mapping when the provided value is mapping-like."""
    if not isinstance(value, Mapping):
        return None

    return cast("Mapping[str, object]", value)


def _read_text(
    payload: Mapping[str, object],
    key: str,
    default: str = "",
) -> str:
    """Read a string value from a JSON-like mapping."""
    value = payload.get(key, default)
    return value if isinstance(value, str) else default


def _read_optional_text(payload: Mapping[str, object], key: str) -> str | None:
    """Read an optional string value from a JSON-like mapping."""
    value = payload.get(key)
    if isinstance(value, str) and value.strip():
        return value

    return None


def _read_bool(
    payload: Mapping[str, object],
    key: str,
) -> bool:
    """Read a boolean value from a JSON-like mapping."""
    value = payload.get(key, False)
    return value if isinstance(value, bool) else bool(value)


def _serialize_note_blocks(note_blocks: tuple[NoteBlock, ...]) -> str:
    """Serialize domain note blocks into a compact JSON document."""
    serialized_blocks = [
        {
            "id": note_block.id,
            "items": [
                {
                    "checked": item.checked,
                    "id": item.id,
                    "kind": item.kind,
                    "text": item.text,
                }
                for item in note_block.items
            ],
            "label": note_block.label,
        }
        for note_block in note_blocks
    ]
    return json.dumps(serialized_blocks, separators=(",", ":"))


def _normalize_note_block_kind(
    raw_kind: str,
    fallback: NoteBlockKind = "text",
) -> NoteBlockKind:
    """Return a supported note-item kind or fall back to a safe default."""
    if raw_kind in VALID_NOTE_BLOCK_KINDS:
        return cast("NoteBlockKind", raw_kind)

    return fallback


def _default_note_block_label(block_id: str) -> str | None:
    """Return the default label for one of the fixed note sections."""
    for note_block in default_note_blocks():
        if note_block.id == block_id:
            return note_block.label

    return None


def _build_legacy_text_items(
    block_id: str,
    raw_text: str,
) -> tuple[NoteBlockItem, ...]:
    """Convert legacy block text into row-based note items."""
    stripped_text = raw_text.strip()
    if not stripped_text:
        return ()

    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    normalized_lines = lines or [stripped_text]

    return tuple(
        NoteBlockItem(
            id=f"{block_id}-legacy-{index + 1}",
            kind="text",
            text=line,
        )
        for index, line in enumerate(normalized_lines)
    )


def _parse_note_block_items(
    raw_items: object,
    fallback_kind: NoteBlockKind = "text",
) -> tuple[NoteBlockItem, ...]:
    """Parse stored note block items into domain objects."""
    if not isinstance(raw_items, list):
        return ()

    parsed_items: list[NoteBlockItem] = []
    for raw_item in raw_items:
        payload = _as_mapping(raw_item)
        if payload is None:
            continue

        item_id = _read_text(payload, "id")
        if not item_id:
            continue

        parsed_items.append(
            NoteBlockItem(
                id=item_id,
                kind=_normalize_note_block_kind(
                    _read_text(payload, "kind", fallback_kind),
                    fallback_kind,
                ),
                text=_read_text(payload, "text"),
                checked=_read_bool(payload, "checked"),
            ),
        )

    return tuple(parsed_items)


def _parse_note_block(raw_block: object) -> NoteBlock | None:
    """Parse one stored note block into a domain object."""
    payload = _as_mapping(raw_block)
    if payload is None:
        return None

    block_id = _read_text(payload, "id")
    if not block_id:
        return None

    legacy_kind = _normalize_note_block_kind(_read_text(payload, "kind", "text"))
    parsed_items = _parse_note_block_items(payload.get("items", ()), legacy_kind)

    if not parsed_items:
        parsed_items = _build_legacy_text_items(
            block_id,
            _read_text(payload, "text"),
        )

    return NoteBlock(
        id=block_id,
        label=_read_optional_text(payload, "label")
        or _default_note_block_label(block_id)
        or block_id,
        items=parsed_items,
    )


def _deserialize_note_blocks(raw_json: str) -> tuple[NoteBlock, ...]:
    """Deserialize stored note blocks into domain note blocks."""
    try:
        decoded_payload = json.loads(raw_json)
    except json.JSONDecodeError:
        return default_note_blocks()

    if not isinstance(decoded_payload, list):
        return default_note_blocks()

    parsed_blocks: list[NoteBlock] = []
    for raw_block in decoded_payload:
        parsed_block = _parse_note_block(raw_block)
        if parsed_block is not None:
            parsed_blocks.append(parsed_block)

    return tuple(parsed_blocks) if parsed_blocks else default_note_blocks()


def _build_placeholder_issue_link(change: IssueLocalStateChange) -> str:
    """Build a GitHub issue URL for locally seeded records."""
    return (
        f"https://github.com/{change.repository_full_name}/issues/{change.issue_number}"
    )


def _row_to_tracked_issue(row: sqlite3.Row) -> TrackedIssue:
    """Map a SQLite row into a tracked issue domain object."""
    note_blocks = _deserialize_note_blocks(row["note_blocks_json"])
    priority_value = cast("PriorityValue | None", row["priority"])
    completion_priority = cast(
        "PriorityValue | None",
        row["last_priority_before_completion"],
    )
    remote_state = cast("RemoteIssueState", row["remote_state"])
    local_state = IssueLocalState(
        priority=priority_value,
        is_pinned=bool(row["is_pinned"]),
        local_completed_at=row["local_completed_at"],
        last_priority_before_completion=completion_priority,
        last_pinned_before_completion=bool(row["last_pinned_before_completion"]),
        note_blocks=note_blocks,
        last_interacted_at=row["last_interacted_at"],
    )
    return TrackedIssue(
        issue_key=row["issue_key"],
        github_id=int(row["github_id"]),
        repository_full_name=row["repo_full_name"],
        repository_name=row["repo_name"],
        repository_owner_login=row["repo_owner_login"],
        repository_owner_avatar_url=row["repo_owner_avatar_url"],
        issue_number=int(row["issue_number"]),
        remote_state=remote_state,
        title=row["title"],
        body_markdown=row["body_markdown"],
        html_url=row["html_url"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        closed_at=row["closed_at"],
        is_assigned=bool(row["is_assigned"]),
        local_state=local_state,
        first_seen_at=row["first_seen_at"],
        synced_at=row["synced_at"],
    )


class SqliteTrackedIssueRepository:
    """Persist tracked issues and their local state in SQLite."""

    def __init__(self, database_path: Path) -> None:
        """Store the SQLite database path."""
        self._database_path = database_path

    def initialize_schema(self) -> None:
        """Create the tracked issues schema when it does not yet exist."""
        default_blocks_json = _serialize_note_blocks(default_note_blocks())
        with self._connect() as connection:
            connection.execute(CREATE_TRACKED_ISSUES_TABLE_SQL)
            connection.execute(CREATE_ASSIGNED_INDEX_SQL)
            connection.execute(CREATE_REPOSITORY_INDEX_SQL)
            connection.execute(
                DELETE_UNASSIGNED_DEFAULT_ROWS_SQL,
                (default_blocks_json,),
            )

    def replace_remote_projection(
        self,
        remote_issues: tuple[GitHubAssignedIssue, ...],
    ) -> None:
        """Replace the remote issue projection with the latest assigned feed."""
        refreshed_at = utc_now_iso()
        default_blocks_json = _serialize_note_blocks(default_note_blocks())

        with self._connect() as connection:
            connection.execute("UPDATE tracked_issues SET is_assigned = 0")
            for remote_issue in remote_issues:
                self._upsert_remote_issue(
                    connection=connection,
                    remote_issue=remote_issue,
                    default_blocks_json=default_blocks_json,
                    refreshed_at=refreshed_at,
                )

            connection.execute(
                DELETE_UNASSIGNED_DEFAULT_ROWS_SQL,
                (default_blocks_json,),
            )

    def list_visible_issues(
        self,
        closed_window_months: int | None,
    ) -> tuple[TrackedIssue, ...]:
        """List issues visible for the selected closed-issue filter."""
        with self._connect() as connection:
            if closed_window_months is None:
                rows = connection.execute(LIST_VISIBLE_ISSUES_SQL).fetchall()
            else:
                cutoff_timestamp = (
                    subtract_months(
                        moment=utc_now(),
                        months=closed_window_months,
                    )
                    .isoformat(timespec="seconds")
                    .replace("+00:00", "Z")
                )
                rows = connection.execute(
                    LIST_VISIBLE_RECENTLY_CLOSED_ISSUES_SQL,
                    (cutoff_timestamp,),
                ).fetchall()

        return tuple(_row_to_tracked_issue(row) for row in rows)

    def get_tracked_issue(self, issue_key: str) -> TrackedIssue | None:
        """Return one tracked issue when it is already persisted."""
        with self._connect() as connection:
            row = connection.execute(
                GET_TRACKED_ISSUE_BY_KEY_SQL,
                (issue_key,),
            ).fetchone()

        if row is None:
            return None

        return _row_to_tracked_issue(row)

    def upsert_local_states(
        self,
        changes: tuple[IssueLocalStateChange, ...],
    ) -> int:
        """Persist the provided local state changes."""
        synced_at = utc_now_iso()
        with self._connect() as connection:
            for change in changes:
                self._ensure_tracked_issue(
                    connection=connection,
                    change=change,
                    synced_at=synced_at,
                )
                connection.execute(
                    UPDATE_LOCAL_STATE_SQL,
                    (
                        change.state.priority,
                        SQLITE_TRUE if change.state.is_pinned else SQLITE_FALSE,
                        change.state.local_completed_at,
                        change.state.last_priority_before_completion,
                        (
                            SQLITE_TRUE
                            if change.state.last_pinned_before_completion
                            else SQLITE_FALSE
                        ),
                        _serialize_note_blocks(change.state.note_blocks),
                        change.state.last_interacted_at,
                        synced_at,
                        change.issue_key,
                    ),
                )

        return len(changes)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        """Open a SQLite connection configured with row access by name."""
        connection = sqlite3.connect(self._database_path)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _upsert_remote_issue(
        self,
        connection: sqlite3.Connection,
        remote_issue: GitHubAssignedIssue,
        default_blocks_json: str,
        refreshed_at: str,
    ) -> None:
        """Upsert one GitHub issue into the tracked-issues projection."""
        issue_key = build_issue_key(
            repository_full_name=remote_issue.repository_full_name,
            issue_number=remote_issue.issue_number,
        )
        connection.execute(
            UPSERT_REMOTE_ISSUE_SQL,
            (
                issue_key,
                remote_issue.github_id,
                remote_issue.repository_full_name,
                remote_issue.repository_name,
                remote_issue.repository_owner_login,
                remote_issue.repository_owner_avatar_url,
                remote_issue.issue_number,
                remote_issue.remote_state,
                remote_issue.title,
                remote_issue.body_markdown,
                remote_issue.html_url,
                remote_issue.created_at,
                remote_issue.updated_at,
                remote_issue.closed_at,
                SQLITE_TRUE,
                default_blocks_json,
                refreshed_at,
                refreshed_at,
            ),
        )

    def _ensure_tracked_issue(
        self,
        connection: sqlite3.Connection,
        change: IssueLocalStateChange,
        synced_at: str,
    ) -> None:
        """Seed a tracked issue row when a local update arrives first."""
        seeded_state = (
            change.state if change.state.note_blocks else default_local_state()
        )
        connection.execute(
            INSERT_MISSING_TRACKED_ISSUE_SQL,
            (
                change.issue_key,
                change.github_id,
                change.repository_full_name,
                change.repository_name,
                change.issue_number,
                _build_placeholder_issue_link(change),
                seeded_state.priority,
                SQLITE_TRUE if seeded_state.is_pinned else SQLITE_FALSE,
                seeded_state.local_completed_at,
                seeded_state.last_priority_before_completion,
                (
                    SQLITE_TRUE
                    if seeded_state.last_pinned_before_completion
                    else SQLITE_FALSE
                ),
                _serialize_note_blocks(seeded_state.note_blocks),
                seeded_state.last_interacted_at,
                synced_at,
                synced_at,
            ),
        )


__all__ = ["SqliteTrackedIssueRepository"]
