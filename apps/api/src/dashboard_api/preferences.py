"""Persist portable dashboard preferences as an atomic JSON document."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from threading import RLock
from typing import TYPE_CHECKING, Literal, cast

if TYPE_CHECKING:
    from pathlib import Path

HistoryUnit = Literal["days", "months", "years"]
RefreshUnit = Literal["minutes", "hours", "days"]
ThemeMode = Literal["light", "dark", "system"]

PREFERENCES_VERSION = 1


@dataclass(frozen=True, slots=True)
class HistoryWindowPreferences:
    """Represent one configurable history window."""

    amount: int = 1
    unit: HistoryUnit = "months"
    unlimited: bool = False


@dataclass(frozen=True, slots=True)
class AutoRefreshPreferences:
    """Represent the optional periodic synchronization interval."""

    enabled: bool = False
    amount: int = 5
    unit: RefreshUnit = "minutes"


@dataclass(frozen=True, slots=True)
class SidebarPreferences:
    """Represent portable issue-sidebar presentation preferences."""

    width: int = 460
    collapsed: bool = False


@dataclass(frozen=True, slots=True)
class DashboardPreferences:
    """Represent all portable application preferences."""

    version: int = PREFERENCES_VERSION
    theme: ThemeMode = "system"
    zoom_factor: float = 1.0
    closed_issue_history: HistoryWindowPreferences = field(
        default_factory=HistoryWindowPreferences,
    )
    pull_request_history: HistoryWindowPreferences = field(
        default_factory=HistoryWindowPreferences,
    )
    auto_refresh: AutoRefreshPreferences = field(
        default_factory=AutoRefreshPreferences,
    )
    sidebar: SidebarPreferences = field(default_factory=SidebarPreferences)
    linked_pull_requests_collapsed: bool = True


MIN_AUTO_REFRESH_MINUTES = 5
MAX_AUTO_REFRESH_MINUTES = 24 * 24 * 60
MIN_SIDEBAR_WIDTH = 320
MAX_SIDEBAR_WIDTH = 960


def _as_dict(value: object) -> dict[str, object]:
    """Return a string-keyed dictionary for JSON-like input."""
    return cast("dict[str, object]", value) if isinstance(value, dict) else {}


def _positive_int(value: object, default: int) -> int:
    """Return a positive integer or a safe default."""
    return (
        value
        if isinstance(value, int) and not isinstance(value, bool) and value > 0
        else default
    )


def _refresh_minutes(amount: int, unit: RefreshUnit) -> int:
    """Convert a refresh preference to minutes."""
    return amount * {"minutes": 1, "hours": 60, "days": 24 * 60}[unit]


def _parse_history(
    value: object,
    *,
    allow_unlimited: bool,
) -> HistoryWindowPreferences:
    """Parse a history-window object with conservative defaults."""
    payload = _as_dict(value)
    raw_unit = payload.get("unit")
    unit = (
        cast("HistoryUnit", raw_unit)
        if raw_unit in {"days", "months", "years"}
        else "months"
    )
    return HistoryWindowPreferences(
        amount=_positive_int(payload.get("amount"), 1),
        unit=unit,
        unlimited=allow_unlimited and payload.get("unlimited") is True,
    )


def _parse_preferences(value: object) -> DashboardPreferences:
    """Parse an untrusted JSON object into supported preferences."""
    payload = _as_dict(value)
    raw_theme = payload.get("theme")
    theme = (
        cast("ThemeMode", raw_theme)
        if raw_theme in {"light", "dark", "system"}
        else "system"
    )
    raw_zoom_factor = payload.get("zoom_factor", payload.get("zoomFactor", 1.0))
    zoom_factor = (
        float(raw_zoom_factor)
        if isinstance(raw_zoom_factor, (int, float))
        and not isinstance(raw_zoom_factor, bool)
        else 1.0
    )
    auto_refresh_payload = _as_dict(
        payload.get("auto_refresh", payload.get("autoRefresh")),
    )
    raw_refresh_unit = auto_refresh_payload.get("unit")
    refresh_unit = (
        cast("RefreshUnit", raw_refresh_unit)
        if raw_refresh_unit in {"minutes", "hours", "days"}
        else "minutes"
    )
    refresh_amount = _positive_int(auto_refresh_payload.get("amount"), 5)
    refresh_minutes = _refresh_minutes(refresh_amount, refresh_unit)
    if not MIN_AUTO_REFRESH_MINUTES <= refresh_minutes <= MAX_AUTO_REFRESH_MINUTES:
        refresh_amount = 5
        refresh_unit = "minutes"

    sidebar_payload = _as_dict(payload.get("sidebar"))
    sidebar_width = _positive_int(sidebar_payload.get("width"), 460)
    sidebar_width = min(MAX_SIDEBAR_WIDTH, max(MIN_SIDEBAR_WIDTH, sidebar_width))

    return DashboardPreferences(
        version=PREFERENCES_VERSION,
        theme=theme,
        zoom_factor=min(1.6, max(0.75, zoom_factor)),
        closed_issue_history=_parse_history(
            payload.get("closed_issue_history", payload.get("closedIssueHistory")),
            allow_unlimited=True,
        ),
        pull_request_history=_parse_history(
            payload.get("pull_request_history", payload.get("pullRequestHistory")),
            allow_unlimited=False,
        ),
        auto_refresh=AutoRefreshPreferences(
            enabled=auto_refresh_payload.get("enabled") is True,
            amount=refresh_amount,
            unit=refresh_unit,
        ),
        sidebar=SidebarPreferences(
            width=sidebar_width,
            collapsed=sidebar_payload.get("collapsed") is True,
        ),
        linked_pull_requests_collapsed=(
            payload.get(
                "linked_pull_requests_collapsed",
                payload.get("linkedPullRequestsCollapsed", True),
            )
            is not False
        ),
    )


class JsonPreferencesStore:
    """Persist preferences in the application data directory."""

    def __init__(self, preferences_path: Path) -> None:
        """Store the JSON path and initialize the in-process lock."""
        self._preferences_path = preferences_path
        self._lock = RLock()
        self._cached_preferences: DashboardPreferences | None = None

    @property
    def path(self) -> Path:
        """Return the preferences document path."""
        return self._preferences_path

    def read(self) -> DashboardPreferences:
        """Return cached preferences or load them from disk."""
        with self._lock:
            if self._cached_preferences is None:
                self._cached_preferences = self._read_from_disk()
            return self._cached_preferences

    def write(self, preferences: DashboardPreferences) -> DashboardPreferences:
        """Validate and atomically persist preferences."""
        normalized = _parse_preferences(asdict(preferences))
        with self._lock:
            self._write_to_disk(normalized)
            self._cached_preferences = normalized
        return normalized

    def reload(self) -> DashboardPreferences:
        """Discard cached preferences and read the current document."""
        with self._lock:
            self._cached_preferences = self._read_from_disk()
            return self._cached_preferences

    def _read_from_disk(self) -> DashboardPreferences:
        """Read preferences from disk, returning defaults when unavailable."""
        if not self._preferences_path.exists():
            return DashboardPreferences()
        try:
            payload = json.loads(self._preferences_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return DashboardPreferences()
        return _parse_preferences(payload)

    def _write_to_disk(self, preferences: DashboardPreferences) -> None:
        """Write a complete preferences document using an atomic replace."""
        self._preferences_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self._preferences_path.with_suffix(
            f"{self._preferences_path.suffix}.tmp",
        )
        temporary_path.write_text(
            json.dumps(asdict(preferences), indent=2, sort_keys=True),
            encoding="utf-8",
        )
        temporary_path.replace(self._preferences_path)


__all__ = [
    "PREFERENCES_VERSION",
    "AutoRefreshPreferences",
    "DashboardPreferences",
    "HistoryUnit",
    "HistoryWindowPreferences",
    "JsonPreferencesStore",
    "RefreshUnit",
    "SidebarPreferences",
    "ThemeMode",
]
