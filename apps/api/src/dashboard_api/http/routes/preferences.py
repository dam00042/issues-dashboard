"""Expose portable dashboard preferences."""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from fastapi import APIRouter, Request

from dashboard_api.http.schemas import DashboardPreferencesPayload

if TYPE_CHECKING:
    from dashboard_api.preferences import (
        JsonPreferencesStore,
    )

router = APIRouter(prefix="/api/preferences", tags=["preferences"])


def _get_store(request: Request) -> JsonPreferencesStore:
    """Return the configured preference store."""
    return cast("JsonPreferencesStore", request.app.state.preferences_store)


@router.get("", response_model=DashboardPreferencesPayload)
def get_preferences(request: Request) -> DashboardPreferencesPayload:
    """Return portable dashboard preferences without remote I/O."""
    return DashboardPreferencesPayload.from_domain(
        _get_store(request).read(),
    )


@router.put("", response_model=DashboardPreferencesPayload)
def replace_preferences(
    payload: DashboardPreferencesPayload,
    request: Request,
) -> DashboardPreferencesPayload:
    """Atomically replace portable dashboard preferences."""
    preferences = _get_store(request).write(payload.to_domain())
    return DashboardPreferencesPayload.from_domain(preferences)


__all__ = ["router"]
