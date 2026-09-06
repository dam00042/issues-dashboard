"""Expose portable dashboard preferences."""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from fastapi import APIRouter, Request

from dashboard_api.presentation.http.schemas import DashboardPreferencesPayload

if TYPE_CHECKING:
    from dashboard_api.application.preferences.service import (
        DashboardPreferencesService,
    )

router = APIRouter(prefix="/api/preferences", tags=["preferences"])


def _get_service(request: Request) -> DashboardPreferencesService:
    """Return the configured preference service."""
    return cast("DashboardPreferencesService", request.app.state.preferences_service)


@router.get("", response_model=DashboardPreferencesPayload)
def get_preferences(request: Request) -> DashboardPreferencesPayload:
    """Return portable dashboard preferences without remote I/O."""
    return DashboardPreferencesPayload.from_domain(
        _get_service(request).get_preferences(),
    )


@router.put("", response_model=DashboardPreferencesPayload)
def replace_preferences(
    payload: DashboardPreferencesPayload,
    request: Request,
) -> DashboardPreferencesPayload:
    """Atomically replace portable dashboard preferences."""
    preferences = _get_service(request).replace_preferences(payload.to_domain())
    return DashboardPreferencesPayload.from_domain(preferences)


__all__ = ["router"]
