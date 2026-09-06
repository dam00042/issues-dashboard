"""Coordinate portable dashboard preference use cases."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from dashboard_api.domain.preferences.models import DashboardPreferences


class DashboardPreferencesStore(Protocol):
    """Describe persistence required by the preference service."""

    def read(self) -> DashboardPreferences:
        """Return persisted preferences or their defaults."""

    def write(self, preferences: DashboardPreferences) -> DashboardPreferences:
        """Persist and return validated preferences."""

    def reload(self) -> DashboardPreferences:
        """Discard cached state and read preferences from disk."""


class DashboardPreferencesService:
    """Expose typed preference reads and writes."""

    def __init__(self, store: DashboardPreferencesStore) -> None:
        """Store the persistence adapter."""
        self._store = store

    def get_preferences(self) -> DashboardPreferences:
        """Return the current preferences."""
        return self._store.read()

    def replace_preferences(
        self,
        preferences: DashboardPreferences,
    ) -> DashboardPreferences:
        """Replace portable preferences atomically."""
        return self._store.write(preferences)

    def reload_preferences(self) -> DashboardPreferences:
        """Reload preferences after a backup restore."""
        return self._store.reload()


__all__ = ["DashboardPreferencesService", "DashboardPreferencesStore"]
