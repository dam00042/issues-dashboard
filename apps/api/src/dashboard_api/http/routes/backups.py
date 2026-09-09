"""Expose complete local backup operations to the Electron shell."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, cast

from fastapi import APIRouter, HTTPException, Request, status

from dashboard_api.http.schemas import (
    BackupExportResponse,
    BackupImportResponse,
    BackupInspectionResponse,
    BackupPathPayload,
)

if TYPE_CHECKING:
    from dashboard_api.backups import DashboardBackupService

router = APIRouter(prefix="/api/backups", tags=["backups"])


def _get_service(request: Request) -> DashboardBackupService:
    """Return the configured complete-backup service."""
    return cast("DashboardBackupService", request.app.state.backup_service)


@router.post("/export", response_model=BackupExportResponse)
def export_backup(
    payload: BackupPathPayload,
    request: Request,
) -> BackupExportResponse:
    """Export SQLite and portable preferences to one archive."""
    try:
        exported_path = _get_service(request).export_backup(Path(payload.path))
    except (OSError, RuntimeError, TypeError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    return BackupExportResponse(path=str(exported_path))


@router.post("/import", response_model=BackupImportResponse)
def import_backup(
    payload: BackupPathPayload,
    request: Request,
) -> BackupImportResponse:
    """Validate and atomically restore a complete local backup."""
    try:
        result = _get_service(request).import_backup(Path(payload.path))
    except (OSError, RuntimeError, TypeError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    return BackupImportResponse(
        path=payload.path,
        source_account=result.source_account,
        created_at=result.created_at,
        schema_version=result.schema_version,
        safety_backup_path=result.safety_backup_path,
    )


@router.post("/inspect", response_model=BackupInspectionResponse)
def inspect_backup(
    payload: BackupPathPayload,
    request: Request,
) -> BackupInspectionResponse:
    """Validate an archive and return confirmation metadata."""
    try:
        result = _get_service(request).inspect_backup(Path(payload.path))
    except (OSError, RuntimeError, TypeError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    return BackupInspectionResponse(
        source_account=result.source_account,
        created_at=result.created_at,
        schema_version=result.schema_version,
    )


__all__ = ["router"]
