"""Expose health-check routes."""

from __future__ import annotations

from typing import cast

from fastapi import APIRouter, Request

from dashboard_api import __version__

API_CONTRACT_VERSION = 1

router = APIRouter(tags=["health"])


@router.get("/health", response_model=dict[str, str | int])
def get_health(request: Request) -> dict[str, str | int]:
    """Return liveness plus bundled contract and schema versions."""
    return {
        "apiVersion": __version__,
        "contractVersion": API_CONTRACT_VERSION,
        "schemaVersion": cast("int", request.app.state.schema_version),
        "status": "ok",
    }
