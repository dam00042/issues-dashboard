"""Parse compact history-window values shared by local API routes."""

from __future__ import annotations

import re

from dashboard_api.domain.issues.models import ClosedIssueWindow, PullRequestWindow


def parse_closed_issue_window(raw_value: str) -> ClosedIssueWindow | None:
    """Parse `all` or a positive amount followed by d, m or y."""
    normalized_value = raw_value.strip().lower()
    if normalized_value == "all":
        return None
    match = re.fullmatch(r"(\d+)([dmy])?", normalized_value)
    if match is None or int(match.group(1)) <= 0:
        message = "closed_window debe ser 'all' o un entero positivo con d, m o y."
        raise ValueError(message)
    return ClosedIssueWindow(
        amount=int(match.group(1)),
        unit={"d": "days", "m": "months", "y": "years"}.get(
            match.group(2) or "m",
            "months",
        ),
    )


def parse_pull_request_window(raw_value: str) -> PullRequestWindow:
    """Parse a positive amount followed by d, m or y."""
    match = re.fullmatch(r"(\d+)([dmy])?", raw_value.strip().lower())
    if match is None or int(match.group(1)) <= 0:
        message = "window debe ser un entero positivo con d, m o y."
        raise ValueError(message)
    return PullRequestWindow(
        amount=int(match.group(1)),
        unit={"d": "days", "m": "months", "y": "years"}.get(
            match.group(2) or "m",
            "months",
        ),
    )


__all__ = ["parse_closed_issue_window", "parse_pull_request_window"]
