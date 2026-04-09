"""Test domain defaults and time helpers."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest import TestCase

from dashboard_api.domain.issues.defaults import default_note_blocks
from dashboard_api.shared.time import subtract_months

DEFAULT_BLOCK_COUNT = 2
EXPECTED_FEBRUARY_MONTH = 2
EXPECTED_LEAP_DAY = 29


class DomainDefaultsTests(TestCase):
    """Verify issue-domain defaults."""

    def test_default_note_blocks_seed_context_and_next_action(self) -> None:
        """Seed the default note blocks used for new issues."""
        blocks = default_note_blocks()

        if len(blocks) != DEFAULT_BLOCK_COUNT:
            message = "Expected two seeded note blocks."
            raise AssertionError(message)
        if blocks[0].label != "Contexto":
            message = "Expected the first seeded block to capture context."
            raise AssertionError(message)
        if blocks[1].label != "Siguientes pasos":
            message = "Expected the second seeded block to capture next steps."
            raise AssertionError(message)
        if blocks[0].items[0].kind != "text" or blocks[1].items[0].kind != "text":
            message = "Expected the default seeded note items to be text rows."
            raise AssertionError(message)


class TimeHelpersTests(TestCase):
    """Verify the month-subtraction helper."""

    def test_subtract_months_clips_the_day_to_the_month_length(self) -> None:
        """Clip the resulting day when the previous month is shorter."""
        march_end = datetime(2024, 3, 31, 12, 0, tzinfo=UTC)

        result = subtract_months(march_end, 1)

        if result.month != EXPECTED_FEBRUARY_MONTH or result.day != EXPECTED_LEAP_DAY:
            message = "Expected February 29 after subtracting one month."
            raise AssertionError(message)
