"""Provide issue-domain defaults and helpers."""

from __future__ import annotations

from dashboard_api.domain.issues.models import (
    IssueLocalState,
    NoteBlock,
    NoteBlockItem,
)

ISSUE_KEY_SEPARATOR = "#"
CONTEXT_BLOCK_ID = "context"
NEXT_ACTION_BLOCK_ID = "next-action"
CONTEXT_ITEM_ID = "context-item-1"
NEXT_ACTION_ITEM_ID = "next-action-item-1"


def build_issue_key(repository_full_name: str, issue_number: int) -> str:
    """Build the stable local mapping key for an issue."""
    return f"{repository_full_name}{ISSUE_KEY_SEPARATOR}{issue_number}"


def default_note_blocks() -> tuple[NoteBlock, ...]:
    """Return the default notes sections for a newly discovered issue."""
    return (
        NoteBlock(
            id=CONTEXT_BLOCK_ID,
            label="Contexto",
            items=(
                NoteBlockItem(
                    id=CONTEXT_ITEM_ID,
                    kind="text",
                    text="",
                ),
            ),
        ),
        NoteBlock(
            id=NEXT_ACTION_BLOCK_ID,
            label="Siguientes pasos",
            items=(
                NoteBlockItem(
                    id=NEXT_ACTION_ITEM_ID,
                    kind="text",
                    text="",
                ),
            ),
        ),
    )


def default_local_state() -> IssueLocalState:
    """Return the default local state for a newly discovered issue."""
    return IssueLocalState(
        priority=None,
        is_pinned=False,
        local_completed_at=None,
        last_priority_before_completion=None,
        last_pinned_before_completion=False,
        note_blocks=default_note_blocks(),
        last_interacted_at=None,
    )
