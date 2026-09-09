"""Persist tracked issues in SQLite."""

from __future__ import annotations

import json
from collections.abc import Mapping
from contextlib import contextmanager
from datetime import timedelta
from typing import TYPE_CHECKING, cast

from dashboard_api.issues.defaults import (
    build_issue_key,
    default_local_state,
    default_note_blocks,
)
from dashboard_api.issues.models import (
    ClosedIssueWindow,
    GitHubAssignedIssue,
    GitHubProjectFieldValue,
    GitHubProjectItem,
    GitHubPullRequest,
    IssueLocalState,
    IssueLocalStateChange,
    IssueLocalStateTarget,
    IssueLocalStatus,
    NoteBlock,
    NoteBlockItem,
    NoteBlockKind,
    PriorityValue,
    ProjectFieldKind,
    PullRequestReviewDecision,
    PullRequestState,
    PullRequestViewerRole,
    PullRequestWindow,
    RemoteIssueState,
    TrackedIssue,
)
from dashboard_api.persistence.sqlite_database import SqliteDatabase
from dashboard_api.time_utils import (
    subtract_months,
    utc_now,
    utc_now_iso,
)

if TYPE_CHECKING:
    import sqlite3
    from collections.abc import Callable, Iterator
    from pathlib import Path


SQLITE_TRUE = 1
SQLITE_FALSE = 0
VALID_NOTE_BLOCK_KINDS = frozenset({"text", "checklist", "ordered"})
VALID_PROJECT_FIELD_KINDS = frozenset(
    {
        "date",
        "iteration",
        "labels",
        "milestone",
        "multi_select",
        "number",
        "pull_requests",
        "repository",
        "reviewers",
        "single_select",
        "text",
        "users",
    },
)

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
    project_items_json TEXT NOT NULL DEFAULT '[]',
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

CREATE_PULL_REQUESTS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS pull_requests (
    node_id TEXT PRIMARY KEY,
    repo_full_name TEXT NOT NULL,
    pr_number INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    html_url TEXT NOT NULL DEFAULT '',
    remote_state TEXT NOT NULL,
    is_draft INTEGER NOT NULL DEFAULT 0,
    author_login TEXT NOT NULL DEFAULT '',
    reviewer_logins_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT,
    merged_at TEXT,
    review_decision TEXT,
    viewer_review_state TEXT,
    review_requested_from_viewer INTEGER NOT NULL DEFAULT 0,
    viewer_role TEXT,
    comments_count INTEGER NOT NULL DEFAULT 0,
    synced_at TEXT NOT NULL
)
"""

CREATE_PULL_REQUESTS_UPDATED_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_pull_requests_updated
ON pull_requests (updated_at DESC, viewer_role, remote_state)
"""

ADD_PULL_REQUEST_REVIEWERS_COLUMN_SQL = """
ALTER TABLE pull_requests
ADD COLUMN reviewer_logins_json TEXT NOT NULL DEFAULT '[]'
"""

CREATE_DASHBOARD_METADATA_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS dashboard_metadata (
    metadata_key TEXT PRIMARY KEY,
    metadata_value TEXT NOT NULL
)
"""

UPSERT_PULL_REQUEST_SQL = """
INSERT INTO pull_requests (
    node_id,
    repo_full_name,
    pr_number,
    title,
    html_url,
    remote_state,
    is_draft,
    author_login,
    reviewer_logins_json,
    updated_at,
    merged_at,
    review_decision,
    viewer_review_state,
    review_requested_from_viewer,
    viewer_role,
    comments_count,
    synced_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(node_id) DO UPDATE SET
    repo_full_name = excluded.repo_full_name,
    pr_number = excluded.pr_number,
    title = excluded.title,
    html_url = excluded.html_url,
    remote_state = excluded.remote_state,
    is_draft = excluded.is_draft,
    author_login = excluded.author_login,
    reviewer_logins_json = excluded.reviewer_logins_json,
    updated_at = excluded.updated_at,
    merged_at = excluded.merged_at,
    review_decision = excluded.review_decision,
    viewer_review_state = excluded.viewer_review_state,
    review_requested_from_viewer = excluded.review_requested_from_viewer,
    viewer_role = excluded.viewer_role,
    comments_count = excluded.comments_count,
    synced_at = excluded.synced_at
WHERE
    pull_requests.repo_full_name IS NOT excluded.repo_full_name
    OR pull_requests.pr_number IS NOT excluded.pr_number
    OR pull_requests.title IS NOT excluded.title
    OR pull_requests.html_url IS NOT excluded.html_url
    OR pull_requests.remote_state IS NOT excluded.remote_state
    OR pull_requests.is_draft IS NOT excluded.is_draft
    OR pull_requests.author_login IS NOT excluded.author_login
    OR pull_requests.reviewer_logins_json IS NOT excluded.reviewer_logins_json
    OR pull_requests.updated_at IS NOT excluded.updated_at
    OR pull_requests.merged_at IS NOT excluded.merged_at
    OR pull_requests.review_decision IS NOT excluded.review_decision
    OR pull_requests.viewer_review_state IS NOT excluded.viewer_review_state
    OR pull_requests.review_requested_from_viewer
        IS NOT excluded.review_requested_from_viewer
    OR pull_requests.viewer_role IS NOT excluded.viewer_role
    OR pull_requests.comments_count IS NOT excluded.comments_count
"""

UPSERT_LINKED_PULL_REQUEST_SQL = """
INSERT INTO pull_requests (
    node_id,
    repo_full_name,
    pr_number,
    title,
    html_url,
    remote_state,
    is_draft,
    author_login,
    reviewer_logins_json,
    updated_at,
    merged_at,
    review_decision,
    viewer_review_state,
    review_requested_from_viewer,
    viewer_role,
    comments_count,
    synced_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(node_id) DO UPDATE SET
    repo_full_name = excluded.repo_full_name,
    pr_number = excluded.pr_number,
    title = excluded.title,
    html_url = excluded.html_url,
    remote_state = excluded.remote_state,
    is_draft = excluded.is_draft,
    author_login = excluded.author_login,
    updated_at = excluded.updated_at,
    merged_at = excluded.merged_at
WHERE
    pull_requests.repo_full_name IS NOT excluded.repo_full_name
    OR pull_requests.pr_number IS NOT excluded.pr_number
    OR pull_requests.title IS NOT excluded.title
    OR pull_requests.html_url IS NOT excluded.html_url
    OR pull_requests.remote_state IS NOT excluded.remote_state
    OR pull_requests.is_draft IS NOT excluded.is_draft
    OR pull_requests.author_login IS NOT excluded.author_login
    OR pull_requests.updated_at IS NOT excluded.updated_at
    OR pull_requests.merged_at IS NOT excluded.merged_at
"""

LIST_PULL_REQUESTS_SQL = """
SELECT *
FROM pull_requests
WHERE updated_at IS NULL OR updated_at >= ?
ORDER BY COALESCE(updated_at, synced_at) DESC, repo_full_name ASC, pr_number DESC
"""

UPSERT_METADATA_SQL = """
INSERT INTO dashboard_metadata (metadata_key, metadata_value)
VALUES (?, ?)
ON CONFLICT(metadata_key) DO UPDATE SET metadata_value = excluded.metadata_value
"""

GET_METADATA_SQL = """
SELECT metadata_value
FROM dashboard_metadata
WHERE metadata_key = ?
LIMIT 1
"""

PULL_REQUESTS_REFRESHED_AT_KEY = "pull_requests_refreshed_at"
ISSUES_REFRESHED_AT_KEY = "issues_refreshed_at"
NORMALIZED_PROJECTIONS_BACKFILLED_KEY = "normalized_projections_backfilled_v2"

ADD_PROJECT_ITEMS_COLUMN_SQL = """
ALTER TABLE tracked_issues
ADD COLUMN project_items_json TEXT NOT NULL DEFAULT '[]'
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
    project_items_json,
    is_assigned,
    note_blocks_json,
    first_seen_at,
    synced_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    project_items_json = CASE
        WHEN ? THEN tracked_issues.project_items_json
        ELSE excluded.project_items_json
    END,
    is_assigned = excluded.is_assigned,
    synced_at = excluded.synced_at
WHERE
    tracked_issues.github_id IS NOT excluded.github_id
    OR tracked_issues.repo_full_name IS NOT excluded.repo_full_name
    OR tracked_issues.repo_name IS NOT excluded.repo_name
    OR tracked_issues.repo_owner_login IS NOT excluded.repo_owner_login
    OR tracked_issues.repo_owner_avatar_url IS NOT excluded.repo_owner_avatar_url
    OR tracked_issues.issue_number IS NOT excluded.issue_number
    OR tracked_issues.remote_state IS NOT excluded.remote_state
    OR tracked_issues.title IS NOT excluded.title
    OR tracked_issues.body_markdown IS NOT excluded.body_markdown
    OR tracked_issues.html_url IS NOT excluded.html_url
    OR tracked_issues.created_at IS NOT excluded.created_at
    OR tracked_issues.updated_at IS NOT excluded.updated_at
    OR tracked_issues.closed_at IS NOT excluded.closed_at
    OR tracked_issues.is_assigned IS NOT excluded.is_assigned
    OR (? = 0 AND tracked_issues.project_items_json IS NOT excluded.project_items_json)
"""

UPSERT_PROJECT_VALUE_SQL = """
INSERT INTO issue_project_values (
    issue_key,
    project_id,
    project_number,
    project_title,
    project_url,
    field_id,
    field_name,
    normalized_field_name,
    field_kind,
    field_value
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(issue_key, project_id, field_id, field_value) DO UPDATE SET
    project_number = excluded.project_number,
    project_title = excluded.project_title,
    project_url = excluded.project_url,
    field_name = excluded.field_name,
    normalized_field_name = excluded.normalized_field_name,
    field_kind = excluded.field_kind
"""

INSERT_ISSUE_PULL_REQUEST_SQL = """
INSERT OR IGNORE INTO issue_pull_requests (
    issue_key,
    pull_request_node_id
) VALUES (?, ?)
"""

INSERT_PULL_REQUEST_REVIEWER_SQL = """
INSERT OR IGNORE INTO pull_request_reviewers (
    pull_request_node_id,
    reviewer_login
) VALUES (?, ?)
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
    local_status = ?,
    priority = ?,
    is_pinned = ?,
    local_completed_at = ?,
    last_priority_before_completion = ?,
    last_pinned_before_completion = ?,
    note_blocks_json = CASE WHEN ? THEN note_blocks_json ELSE ? END,
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
    AND local_status = 'active'
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


def _deserialize_string_tuple(raw_value: object) -> tuple[str, ...]:
    """Deserialize a JSON list into unique non-empty strings."""
    if not isinstance(raw_value, str):
        return ()
    try:
        values = json.loads(raw_value)
    except json.JSONDecodeError:
        return ()
    if not isinstance(values, list):
        return ()
    return tuple(
        dict.fromkeys(value for value in values if isinstance(value, str) and value)
    )


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


def _serialize_project_items(project_items: tuple[GitHubProjectItem, ...]) -> str:
    """Serialize GitHub Projects metadata into a compact JSON document."""
    serialized_items = [
        {
            "fields": [
                {
                    "fieldId": field.field_id,
                    "fieldName": field.field_name,
                    "kind": field.kind,
                    "value": field.value,
                }
                for field in project_item.fields
            ],
            "projectId": project_item.project_id,
            "projectNumber": project_item.project_number,
            "projectTitle": project_item.project_title,
            "projectUrl": project_item.project_url,
            "linkedPullRequests": [
                {
                    "authorLogin": pull_request.author_login,
                    "reviewerLogins": list(pull_request.reviewer_logins),
                    "commentsCount": pull_request.comments_count,
                    "htmlUrl": pull_request.html_url,
                    "isDraft": pull_request.is_draft,
                    "mergedAt": pull_request.merged_at,
                    "nodeId": pull_request.node_id,
                    "number": pull_request.number,
                    "repositoryFullName": pull_request.repository_full_name,
                    "reviewDecision": pull_request.review_decision,
                    "reviewRequestedFromViewer": (
                        pull_request.review_requested_from_viewer
                    ),
                    "state": pull_request.state,
                    "title": pull_request.title,
                    "updatedAt": pull_request.updated_at,
                    "viewerReviewState": pull_request.viewer_review_state,
                    "viewerRole": pull_request.viewer_role,
                }
                for pull_request in project_item.linked_pull_requests
            ],
        }
        for project_item in project_items
    ]
    return json.dumps(serialized_items, separators=(",", ":"))


def _deserialize_project_items(raw_json: str) -> tuple[GitHubProjectItem, ...]:
    """Deserialize stored GitHub Projects metadata."""
    try:
        decoded_payload = json.loads(raw_json)
    except json.JSONDecodeError:
        return ()

    if not isinstance(decoded_payload, list):
        return ()

    project_items: list[GitHubProjectItem] = []
    for raw_project_item in decoded_payload:
        project_payload = _as_mapping(raw_project_item)
        if project_payload is None:
            continue

        project_id = _read_text(project_payload, "projectId")
        project_title = _read_text(project_payload, "projectTitle")
        if not project_id or not project_title:
            continue

        fields: list[GitHubProjectFieldValue] = []
        raw_fields = project_payload.get("fields")
        if isinstance(raw_fields, list):
            for raw_field in raw_fields:
                field_payload = _as_mapping(raw_field)
                if field_payload is None:
                    continue
                kind = _read_text(field_payload, "kind")
                field_id = _read_text(field_payload, "fieldId")
                field_name = _read_text(field_payload, "fieldName")
                value = _read_text(field_payload, "value")
                if (
                    kind not in VALID_PROJECT_FIELD_KINDS
                    or not field_id
                    or not field_name
                    or not value
                ):
                    continue
                fields.append(
                    GitHubProjectFieldValue(
                        field_id=field_id,
                        field_name=field_name,
                        kind=cast("ProjectFieldKind", kind),
                        value=value,
                    ),
                )

        raw_project_number = project_payload.get("projectNumber", 0)
        project_number = (
            raw_project_number if isinstance(raw_project_number, int) else 0
        )
        project_items.append(
            GitHubProjectItem(
                project_id=project_id,
                project_number=project_number,
                project_title=project_title,
                project_url=_read_text(project_payload, "projectUrl"),
                fields=tuple(fields),
                linked_pull_requests=_deserialize_linked_pull_requests(
                    project_payload.get("linkedPullRequests"),
                ),
            ),
        )

    return tuple(project_items)


def _deserialize_linked_pull_requests(
    raw_payload: object,
) -> tuple[GitHubPullRequest, ...]:
    """Deserialize linked Pull Requests stored inside Projects metadata."""
    if not isinstance(raw_payload, list):
        return ()

    pull_requests: list[GitHubPullRequest] = []
    for raw_pull_request in raw_payload:
        pull_request = _as_mapping(raw_pull_request)
        if pull_request is None:
            continue
        node_id = _read_text(pull_request, "nodeId")
        repository_full_name = _read_text(pull_request, "repositoryFullName")
        html_url = _read_text(pull_request, "htmlUrl")
        title = _read_text(pull_request, "title")
        state = _read_text(pull_request, "state")
        raw_number = pull_request.get("number")
        if (
            not node_id
            or not repository_full_name
            or not html_url
            or not title
            or state not in {"open", "closed", "merged"}
            or not isinstance(raw_number, int)
        ):
            continue
        raw_comments_count = pull_request.get("commentsCount")
        pull_requests.append(
            GitHubPullRequest(
                node_id=node_id,
                repository_full_name=repository_full_name,
                number=raw_number,
                title=title,
                html_url=html_url,
                state=cast("PullRequestState", state),
                is_draft=pull_request.get("isDraft") is True,
                author_login=_read_text(pull_request, "authorLogin"),
                updated_at=_read_optional_text(pull_request, "updatedAt"),
                reviewer_logins=tuple(
                    reviewer
                    for reviewer in pull_request.get("reviewerLogins", [])
                    if isinstance(reviewer, str) and reviewer
                )
                if isinstance(pull_request.get("reviewerLogins"), list)
                else (),
                merged_at=_read_optional_text(pull_request, "mergedAt"),
                review_decision=cast(
                    "PullRequestReviewDecision | None",
                    _read_optional_text(pull_request, "reviewDecision"),
                ),
                viewer_review_state=_read_optional_text(
                    pull_request,
                    "viewerReviewState",
                ),
                review_requested_from_viewer=(
                    pull_request.get("reviewRequestedFromViewer") is True
                ),
                viewer_role=cast(
                    "PullRequestViewerRole | None",
                    _read_optional_text(pull_request, "viewerRole"),
                ),
                comments_count=(
                    raw_comments_count if isinstance(raw_comments_count, int) else 0
                ),
            ),
        )
    return tuple(pull_requests)


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


def _row_to_local_state(row: sqlite3.Row) -> IssueLocalState:
    """Read the local workflow and notes without decoding remote details."""
    note_blocks = _deserialize_note_blocks(row["note_blocks_json"])
    priority_value = cast("PriorityValue | None", row["priority"])
    completion_priority = cast(
        "PriorityValue | None",
        row["last_priority_before_completion"],
    )
    return IssueLocalState(
        priority=priority_value,
        is_pinned=bool(row["is_pinned"]),
        local_completed_at=row["local_completed_at"],
        last_priority_before_completion=completion_priority,
        last_pinned_before_completion=bool(row["last_pinned_before_completion"]),
        note_blocks=note_blocks,
        last_interacted_at=row["last_interacted_at"],
        status=cast("IssueLocalStatus", row["local_status"]),
    )


def _row_to_tracked_issue(row: sqlite3.Row) -> TrackedIssue:
    """Map a SQLite row into a tracked issue domain object."""
    return TrackedIssue(
        issue_key=row["issue_key"],
        github_id=int(row["github_id"]),
        repository_full_name=row["repo_full_name"],
        repository_name=row["repo_name"],
        repository_owner_login=row["repo_owner_login"],
        repository_owner_avatar_url=row["repo_owner_avatar_url"],
        issue_number=int(row["issue_number"]),
        remote_state=cast("RemoteIssueState", row["remote_state"]),
        title=row["title"],
        body_markdown=row["body_markdown"],
        html_url=row["html_url"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        closed_at=row["closed_at"],
        is_assigned=bool(row["is_assigned"]),
        local_state=_row_to_local_state(row),
        first_seen_at=row["first_seen_at"],
        synced_at=row["synced_at"],
        project_items=_deserialize_project_items(row["project_items_json"]),
    )


def _row_to_pull_request(row: sqlite3.Row) -> GitHubPullRequest:
    """Map a SQLite row into cached Pull Request activity."""
    return GitHubPullRequest(
        node_id=row["node_id"],
        repository_full_name=row["repo_full_name"],
        number=int(row["pr_number"]),
        title=row["title"],
        html_url=row["html_url"],
        state=cast("PullRequestState", row["remote_state"]),
        is_draft=bool(row["is_draft"]),
        author_login=row["author_login"],
        updated_at=row["updated_at"],
        reviewer_logins=_deserialize_string_tuple(row["reviewer_logins_json"]),
        merged_at=row["merged_at"],
        review_decision=cast(
            "PullRequestReviewDecision | None",
            row["review_decision"],
        ),
        viewer_review_state=row["viewer_review_state"],
        review_requested_from_viewer=bool(row["review_requested_from_viewer"]),
        viewer_role=cast("PullRequestViewerRole | None", row["viewer_role"]),
        comments_count=int(row["comments_count"]),
    )


class SqliteTrackedIssueRepository:
    """Persist tracked issues and their local state in SQLite."""

    def __init__(self, database_path: Path) -> None:
        """Store the SQLite database path."""
        self._database = SqliteDatabase(database_path)

    @property
    def database(self) -> SqliteDatabase:
        """Return the shared low-level database service."""
        return self._database

    def initialize_schema(self) -> None:
        """Create the tracked issues schema when it does not yet exist."""
        default_blocks_json = _serialize_note_blocks(default_note_blocks())
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute(CREATE_TRACKED_ISSUES_TABLE_SQL)
            connection.execute(CREATE_PULL_REQUESTS_TABLE_SQL)
            connection.execute(CREATE_DASHBOARD_METADATA_TABLE_SQL)
            existing_columns = {
                row["name"]
                for row in connection.execute(
                    "PRAGMA table_info(tracked_issues)",
                ).fetchall()
            }
            if "project_items_json" not in existing_columns:
                connection.execute(ADD_PROJECT_ITEMS_COLUMN_SQL)
            existing_pull_request_columns = {
                row["name"]
                for row in connection.execute(
                    "PRAGMA table_info(pull_requests)",
                ).fetchall()
            }
            if "reviewer_logins_json" not in existing_pull_request_columns:
                connection.execute(ADD_PULL_REQUEST_REVIEWERS_COLUMN_SQL)
            connection.execute(CREATE_ASSIGNED_INDEX_SQL)
            connection.execute(CREATE_REPOSITORY_INDEX_SQL)
            connection.execute(CREATE_PULL_REQUESTS_UPDATED_INDEX_SQL)
        self._database.migrate()
        self._backfill_normalized_projections()
        with self._connect() as connection:
            connection.execute(
                DELETE_UNASSIGNED_DEFAULT_ROWS_SQL,
                (default_blocks_json,),
            )

    def replace_remote_projection(
        self,
        remote_issues: tuple[GitHubAssignedIssue, ...],
        *,
        preserve_project_items: bool = False,
    ) -> None:
        """Replace the remote issue projection with the latest assigned feed."""
        refreshed_at = utc_now_iso()
        default_blocks_json = _serialize_note_blocks(default_note_blocks())
        issue_rows = tuple(
            self._remote_issue_values(
                remote_issue=remote_issue,
                default_blocks_json=default_blocks_json,
                preserve_project_items=preserve_project_items,
                refreshed_at=refreshed_at,
            )
            for remote_issue in remote_issues
        )

        issue_keys = tuple(
            build_issue_key(
                repository_full_name=remote_issue.repository_full_name,
                issue_number=remote_issue.issue_number,
            )
            for remote_issue in remote_issues
        )

        with self._connect() as connection:
            connection.execute(
                "CREATE TEMP TABLE refreshed_issue_keys (issue_key TEXT PRIMARY KEY)",
            )
            connection.executemany(
                "INSERT INTO refreshed_issue_keys (issue_key) VALUES (?)",
                ((issue_key,) for issue_key in issue_keys),
            )
            existing_project_json = {
                str(row["issue_key"]): str(row["project_items_json"])
                for row in connection.execute(
                    "SELECT tracked_issues.issue_key, project_items_json "
                    "FROM tracked_issues INNER JOIN refreshed_issue_keys "
                    "ON refreshed_issue_keys.issue_key = tracked_issues.issue_key",
                ).fetchall()
            }
            changed_project_issues = tuple(
                remote_issue
                for remote_issue, issue_key, issue_row in zip(
                    remote_issues,
                    issue_keys,
                    issue_rows,
                    strict=True,
                )
                if existing_project_json.get(issue_key) != issue_row[14]
            )
            connection.executemany(UPSERT_REMOTE_ISSUE_SQL, issue_rows)
            connection.execute(
                "UPDATE tracked_issues SET is_assigned = 0 "
                "WHERE is_assigned = 1 AND issue_key NOT IN "
                "(SELECT issue_key FROM refreshed_issue_keys)",
            )
            connection.execute("DROP TABLE refreshed_issue_keys")

            if not preserve_project_items:
                self._replace_normalized_project_data(
                    connection,
                    changed_project_issues,
                )

            connection.execute(
                UPSERT_METADATA_SQL,
                (ISSUES_REFRESHED_AT_KEY, refreshed_at),
            )

            connection.execute(
                DELETE_UNASSIGNED_DEFAULT_ROWS_SQL,
                (default_blocks_json,),
            )

    def list_visible_issues(
        self,
        closed_window: ClosedIssueWindow | None,
    ) -> tuple[TrackedIssue, ...]:
        """List issues visible for the selected closed-issue filter."""
        with self._connect() as connection:
            if closed_window is None:
                rows = connection.execute(LIST_VISIBLE_ISSUES_SQL).fetchall()
            else:
                if closed_window.unit == "days":
                    cutoff = utc_now() - timedelta(days=closed_window.amount)
                else:
                    months = (
                        closed_window.amount * 12
                        if closed_window.unit == "years"
                        else closed_window.amount
                    )
                    cutoff = subtract_months(moment=utc_now(), months=months)
                cutoff_timestamp = cutoff.isoformat(timespec="seconds").replace(
                    "+00:00", "Z"
                )
                rows = connection.execute(
                    LIST_VISIBLE_RECENTLY_CLOSED_ISSUES_SQL,
                    (cutoff_timestamp,),
                ).fetchall()

        return tuple(_row_to_tracked_issue(row) for row in rows)

    def replace_pull_requests(
        self,
        pull_requests: tuple[GitHubPullRequest, ...],
    ) -> None:
        """Atomically replace the cached Pull Request projection."""
        refreshed_at = utc_now_iso()
        pull_request_rows = tuple(
            (
                pull_request.node_id,
                pull_request.repository_full_name,
                pull_request.number,
                pull_request.title,
                pull_request.html_url,
                pull_request.state,
                SQLITE_TRUE if pull_request.is_draft else SQLITE_FALSE,
                pull_request.author_login,
                json.dumps(pull_request.reviewer_logins, separators=(",", ":")),
                pull_request.updated_at,
                pull_request.merged_at,
                pull_request.review_decision,
                pull_request.viewer_review_state,
                (
                    SQLITE_TRUE
                    if pull_request.review_requested_from_viewer
                    else SQLITE_FALSE
                ),
                pull_request.viewer_role,
                pull_request.comments_count,
                refreshed_at,
            )
            for pull_request in pull_requests
        )
        with self._connect() as connection:
            existing_reviewer_json = {
                str(row["node_id"]): str(row["reviewer_logins_json"])
                for row in connection.execute(
                    "SELECT node_id, reviewer_logins_json FROM pull_requests",
                ).fetchall()
            }
            changed_reviewers = tuple(
                pull_request
                for pull_request, row in zip(
                    pull_requests,
                    pull_request_rows,
                    strict=True,
                )
                if existing_reviewer_json.get(pull_request.node_id) != row[8]
            )
            connection.executemany(UPSERT_PULL_REQUEST_SQL, pull_request_rows)
            connection.executemany(
                "DELETE FROM pull_request_reviewers WHERE pull_request_node_id = ?",
                ((pull_request.node_id,) for pull_request in changed_reviewers),
            )
            connection.executemany(
                INSERT_PULL_REQUEST_REVIEWER_SQL,
                (
                    (pull_request.node_id, reviewer_login)
                    for pull_request in changed_reviewers
                    for reviewer_login in pull_request.reviewer_logins
                ),
            )
            if pull_requests:
                placeholders = ", ".join("?" for _ in pull_requests)
                connection.execute(
                    f"DELETE FROM pull_requests WHERE node_id NOT IN ({placeholders})",  # noqa: S608
                    tuple(pull_request.node_id for pull_request in pull_requests),
                )
            else:
                connection.execute("DELETE FROM pull_requests")
            connection.execute(
                UPSERT_METADATA_SQL,
                (PULL_REQUESTS_REFRESHED_AT_KEY, refreshed_at),
            )

    def list_pull_requests(
        self,
        window: PullRequestWindow,
    ) -> tuple[GitHubPullRequest, ...]:
        """List cached Pull Requests updated inside the requested window."""
        if window.unit == "days":
            cutoff = utc_now() - timedelta(days=window.amount)
        else:
            months = window.amount * 12 if window.unit == "years" else window.amount
            cutoff = subtract_months(moment=utc_now(), months=months)
        cutoff_timestamp = cutoff.isoformat(timespec="seconds").replace("+00:00", "Z")

        with self._connect() as connection:
            rows = connection.execute(
                LIST_PULL_REQUESTS_SQL,
                (cutoff_timestamp,),
            ).fetchall()
        return tuple(_row_to_pull_request(row) for row in rows)

    def get_pull_requests_refreshed_at(self) -> str | None:
        """Return the timestamp of the latest successful PR refresh."""
        with self._connect() as connection:
            row = connection.execute(
                GET_METADATA_SQL,
                (PULL_REQUESTS_REFRESHED_AT_KEY,),
            ).fetchone()
        return str(row["metadata_value"]) if row is not None else None

    def get_issues_refreshed_at(self) -> str | None:
        """Return when assigned issues were last refreshed successfully."""
        with self._connect() as connection:
            row = connection.execute(
                GET_METADATA_SQL,
                (ISSUES_REFRESHED_AT_KEY,),
            ).fetchone()
        return str(row["metadata_value"]) if row is not None else None

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
                self._upsert_local_state(connection, change, synced_at)

        return len(changes)

    def update_local_state(
        self,
        target: IssueLocalStateTarget,
        update_state: Callable[[IssueLocalState], IssueLocalState],
    ) -> int:
        """Serialize local commands before reading the state they will modify."""
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                GET_TRACKED_ISSUE_BY_KEY_SQL,
                (target.issue_key,),
            ).fetchone()
            current_state = (
                _row_to_local_state(row) if row is not None else default_local_state()
            )
            change = IssueLocalStateChange(
                issue_key=target.issue_key,
                github_id=target.github_id,
                repository_full_name=target.repository_full_name,
                repository_name=target.repository_name,
                issue_number=target.issue_number,
                state=update_state(current_state),
            )
            self._upsert_local_state(connection, change, utc_now_iso())
        return 1

    def _upsert_local_state(
        self,
        connection: sqlite3.Connection,
        change: IssueLocalStateChange,
        synced_at: str,
    ) -> None:
        """Persist one local change on the caller's transaction."""
        self._ensure_tracked_issue(connection, change, synced_at)
        connection.execute(
            UPDATE_LOCAL_STATE_SQL,
            (
                change.state.status,
                change.state.priority,
                SQLITE_TRUE if change.state.is_pinned else SQLITE_FALSE,
                change.state.local_completed_at,
                change.state.last_priority_before_completion,
                SQLITE_TRUE
                if change.state.last_pinned_before_completion
                else SQLITE_FALSE,
                change.preserve_note_blocks,
                _serialize_note_blocks(change.state.note_blocks),
                change.state.last_interacted_at,
                synced_at,
                change.issue_key,
            ),
        )

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        """Open a SQLite connection configured with row access by name."""
        with self._database.connect() as connection:
            yield connection

    def _remote_issue_values(
        self,
        remote_issue: GitHubAssignedIssue,
        default_blocks_json: str,
        refreshed_at: str,
        *,
        preserve_project_items: bool,
    ) -> tuple[object, ...]:
        """Build one row for the batched remote issue upsert."""
        issue_key = build_issue_key(
            repository_full_name=remote_issue.repository_full_name,
            issue_number=remote_issue.issue_number,
        )
        return (
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
            _serialize_project_items(remote_issue.project_items),
            SQLITE_TRUE,
            default_blocks_json,
            refreshed_at,
            refreshed_at,
            SQLITE_TRUE if preserve_project_items else SQLITE_FALSE,
            SQLITE_TRUE if preserve_project_items else SQLITE_FALSE,
        )

    def _replace_normalized_project_data(
        self,
        connection: sqlite3.Connection,
        remote_issues: tuple[GitHubAssignedIssue, ...],
    ) -> None:
        """Replace structured Project fields and linked PR relationships."""
        issue_keys = tuple(
            build_issue_key(
                repository_full_name=remote_issue.repository_full_name,
                issue_number=remote_issue.issue_number,
            )
            for remote_issue in remote_issues
        )
        connection.executemany(
            "DELETE FROM issue_project_values WHERE issue_key = ?",
            ((issue_key,) for issue_key in issue_keys),
        )
        connection.executemany(
            "DELETE FROM issue_pull_requests WHERE issue_key = ?",
            ((issue_key,) for issue_key in issue_keys),
        )

        project_rows: list[tuple[object, ...]] = []
        linked_pull_requests: dict[str, GitHubPullRequest] = {}
        relationship_rows: list[tuple[str, str]] = []
        for remote_issue, issue_key in zip(remote_issues, issue_keys, strict=True):
            for project_item in remote_issue.project_items:
                project_rows.extend(
                    (
                        issue_key,
                        project_item.project_id,
                        project_item.project_number,
                        project_item.project_title,
                        project_item.project_url,
                        field.field_id,
                        field.field_name,
                        field.field_name.casefold(),
                        field.kind,
                        field.value,
                    )
                    for field in project_item.fields
                )
                for pull_request in project_item.linked_pull_requests:
                    linked_pull_requests[pull_request.node_id] = pull_request
                    relationship_rows.append((issue_key, pull_request.node_id))

        connection.executemany(UPSERT_PROJECT_VALUE_SQL, project_rows)
        connection.executemany(
            UPSERT_LINKED_PULL_REQUEST_SQL,
            (
                self._pull_request_values(pull_request, utc_now_iso())
                for pull_request in linked_pull_requests.values()
            ),
        )
        connection.executemany(
            INSERT_PULL_REQUEST_REVIEWER_SQL,
            (
                (pull_request.node_id, reviewer_login)
                for pull_request in linked_pull_requests.values()
                for reviewer_login in pull_request.reviewer_logins
            ),
        )
        connection.executemany(
            INSERT_ISSUE_PULL_REQUEST_SQL,
            relationship_rows,
        )

    def _backfill_normalized_projections(self) -> None:
        """Populate v2 projections once from data stored by older releases."""
        with self._connect() as connection:
            completed = connection.execute(
                GET_METADATA_SQL,
                (NORMALIZED_PROJECTIONS_BACKFILLED_KEY,),
            ).fetchone()
            if completed is not None:
                return

            project_rows: list[tuple[object, ...]] = []
            linked_pull_requests: dict[str, GitHubPullRequest] = {}
            relationship_rows: list[tuple[str, str]] = []
            for row in connection.execute(
                "SELECT issue_key, project_items_json FROM tracked_issues",
            ).fetchall():
                issue_key = str(row["issue_key"])
                for project_item in _deserialize_project_items(
                    str(row["project_items_json"]),
                ):
                    project_rows.extend(
                        (
                            issue_key,
                            project_item.project_id,
                            project_item.project_number,
                            project_item.project_title,
                            project_item.project_url,
                            field.field_id,
                            field.field_name,
                            field.field_name.casefold(),
                            field.kind,
                            field.value,
                        )
                        for field in project_item.fields
                    )
                    for pull_request in project_item.linked_pull_requests:
                        linked_pull_requests[pull_request.node_id] = pull_request
                        relationship_rows.append((issue_key, pull_request.node_id))

            connection.executemany(UPSERT_PROJECT_VALUE_SQL, project_rows)
            connection.executemany(
                UPSERT_LINKED_PULL_REQUEST_SQL,
                (
                    self._pull_request_values(pull_request, utc_now_iso())
                    for pull_request in linked_pull_requests.values()
                ),
            )
            connection.executemany(
                INSERT_ISSUE_PULL_REQUEST_SQL,
                relationship_rows,
            )

            for row in connection.execute(
                "SELECT node_id, reviewer_logins_json FROM pull_requests",
            ).fetchall():
                node_id = str(row["node_id"])
                connection.executemany(
                    INSERT_PULL_REQUEST_REVIEWER_SQL,
                    (
                        (node_id, reviewer_login)
                        for reviewer_login in _deserialize_string_tuple(
                            row["reviewer_logins_json"],
                        )
                    ),
                )

            connection.execute(
                UPSERT_METADATA_SQL,
                (NORMALIZED_PROJECTIONS_BACKFILLED_KEY, utc_now_iso()),
            )

    @staticmethod
    def _pull_request_values(
        pull_request: GitHubPullRequest,
        refreshed_at: str,
    ) -> tuple[object, ...]:
        """Build one row for the Pull Request upsert."""
        return (
            pull_request.node_id,
            pull_request.repository_full_name,
            pull_request.number,
            pull_request.title,
            pull_request.html_url,
            pull_request.state,
            SQLITE_TRUE if pull_request.is_draft else SQLITE_FALSE,
            pull_request.author_login,
            json.dumps(pull_request.reviewer_logins, separators=(",", ":")),
            pull_request.updated_at,
            pull_request.merged_at,
            pull_request.review_decision,
            pull_request.viewer_review_state,
            SQLITE_TRUE if pull_request.review_requested_from_viewer else SQLITE_FALSE,
            pull_request.viewer_role,
            pull_request.comments_count,
            refreshed_at,
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
