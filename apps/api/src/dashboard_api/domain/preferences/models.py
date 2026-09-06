"""Define portable, versioned dashboard preferences."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

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


__all__ = [
    "PREFERENCES_VERSION",
    "AutoRefreshPreferences",
    "DashboardPreferences",
    "HistoryUnit",
    "HistoryWindowPreferences",
    "RefreshUnit",
    "SidebarPreferences",
    "ThemeMode",
]
