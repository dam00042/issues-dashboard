"""Expose health-check routes."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health", response_model=dict[str, str])
def get_health() -> dict[str, str]:
    """Return a simple liveness payload."""
    return {"status": "ok"}
