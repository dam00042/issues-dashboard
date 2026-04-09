"""Provide UTC time helpers for the backend."""

from __future__ import annotations

import calendar
from datetime import UTC, datetime

MONTHS_PER_YEAR = 12


def utc_now() -> datetime:
    """Return the current UTC datetime."""
    return datetime.now(tz=UTC)


def utc_now_iso() -> str:
    """Return the current UTC datetime formatted as an ISO timestamp."""
    return utc_now().isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_utc_iso(timestamp: str) -> datetime:
    """Parse a UTC ISO timestamp into an aware datetime."""
    normalized_timestamp = timestamp.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized_timestamp).astimezone(UTC)


def normalize_utc_iso(timestamp: str | None) -> str | None:
    """Normalize an optional timestamp into a UTC ISO string."""
    if timestamp is None or not timestamp.strip():
        return None

    normalized_datetime = parse_utc_iso(timestamp)
    return normalized_datetime.isoformat(timespec="seconds").replace("+00:00", "Z")


def subtract_months(moment: datetime, months: int) -> datetime:
    """Subtract full calendar months from a UTC datetime."""
    if months < 0:
        message = "Months must be zero or greater."
        raise ValueError(message)

    year = moment.year
    month = moment.month - months

    while month <= 0:
        year -= 1
        month += MONTHS_PER_YEAR

    last_day = calendar.monthrange(year, month)[1]
    day = min(moment.day, last_day)
    return moment.replace(year=year, month=month, day=day)
