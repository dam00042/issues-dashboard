"""Create and restore complete, versioned local application backups."""

from __future__ import annotations

import hashlib
import hmac
import json
import shutil
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import TYPE_CHECKING

from dashboard_api.persistence.sqlite_database import (
    CURRENT_SCHEMA_VERSION,
    SqliteDatabase,
)
from dashboard_api.preferences import JsonPreferencesStore
from dashboard_api.time_utils import utc_now, utc_now_iso

if TYPE_CHECKING:
    from _thread import LockType
    from collections.abc import Callable

BACKUP_FORMAT_VERSION = 1
BACKUP_FILE_EXTENSION = ".issues-dashboard-backup"
DATABASE_ARCHIVE_NAME = "database.sqlite"
MANIFEST_ARCHIVE_NAME = "manifest.json"
PREFERENCES_ARCHIVE_NAME = "preferences.json"
MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024
AUTOMATIC_BACKUP_LIMIT = 5


@dataclass(frozen=True, slots=True)
class BackupImportResult:
    """Describe a successfully restored backup."""

    source_account: str | None
    created_at: str
    schema_version: int
    safety_backup_path: str


@dataclass(frozen=True, slots=True)
class BackupInspection:
    """Describe a validated backup before any local data is replaced."""

    source_account: str | None
    created_at: str
    schema_version: int


@dataclass(frozen=True, slots=True)
class BackupManifestContext:
    """Provide metadata that is evaluated when a backup is exported."""

    app_version: str
    account_provider: Callable[[], str | None]


def _sha256(file_path: Path) -> str:
    """Return the SHA-256 checksum for one file."""
    digest = hashlib.sha256()
    with file_path.open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_backup_name(prefix: str = "issues-dashboard") -> str:
    """Build a filesystem-safe timestamped backup name."""
    timestamp = utc_now().strftime("%Y-%m-%dT%H-%M-%SZ")
    return f"{prefix}-{timestamp}{BACKUP_FILE_EXTENSION}"


class DashboardBackupService:
    """Export and restore SQLite data plus portable preferences."""

    def __init__(
        self,
        *,
        database: SqliteDatabase,
        preferences_store: JsonPreferencesStore,
        manifest_context: BackupManifestContext,
        restore_lock: LockType,
    ) -> None:
        """Store local resources and manifest metadata providers."""
        self._database = database
        self._preferences_store = preferences_store
        self._manifest_context = manifest_context
        self._restore_lock = restore_lock

    def export_backup(self, destination_path: Path) -> Path:
        """Create a consistent, checksummed application backup."""
        resolved_destination = self._normalize_destination(destination_path)
        resolved_destination.parent.mkdir(parents=True, exist_ok=True)
        self._database.quick_check()

        with TemporaryDirectory(
            prefix="issues-dashboard-export-",
            dir=resolved_destination.parent,
        ) as temporary_directory:
            temporary_root = Path(temporary_directory)
            database_snapshot = temporary_root / DATABASE_ARCHIVE_NAME
            preferences_snapshot = temporary_root / PREFERENCES_ARCHIVE_NAME
            self._database.backup_to(database_snapshot)
            preferences_snapshot.write_text(
                json.dumps(
                    asdict(self._preferences_store.read()),
                    indent=2,
                    sort_keys=True,
                ),
                encoding="utf-8",
            )
            manifest = {
                "appVersion": self._manifest_context.app_version,
                "createdAt": utc_now_iso(),
                "files": {
                    DATABASE_ARCHIVE_NAME: _sha256(database_snapshot),
                    PREFERENCES_ARCHIVE_NAME: _sha256(preferences_snapshot),
                },
                "formatVersion": BACKUP_FORMAT_VERSION,
                "schemaVersion": self._database.schema_version(),
                "sourceAccount": self._manifest_context.account_provider(),
            }
            (temporary_root / MANIFEST_ARCHIVE_NAME).write_text(
                json.dumps(manifest, indent=2, sort_keys=True),
                encoding="utf-8",
            )
            temporary_archive = temporary_root / "backup.tmp"
            with zipfile.ZipFile(
                temporary_archive,
                mode="w",
                compression=zipfile.ZIP_DEFLATED,
                compresslevel=6,
            ) as archive:
                for archive_name in (
                    MANIFEST_ARCHIVE_NAME,
                    DATABASE_ARCHIVE_NAME,
                    PREFERENCES_ARCHIVE_NAME,
                ):
                    archive.write(temporary_root / archive_name, archive_name)
            temporary_archive.replace(resolved_destination)
        return resolved_destination

    def import_backup(self, source_path: Path) -> BackupImportResult:
        """Validate and atomically restore a complete application backup."""
        if not self._restore_lock.acquire(blocking=False):
            message = (
                "Espera a que termine la sincronización antes de restaurar la copia."
            )
            raise RuntimeError(message)
        try:
            return self._import_backup_locked(source_path)
        finally:
            self._restore_lock.release()

    def _import_backup_locked(self, source_path: Path) -> BackupImportResult:
        """Restore a backup while synchronization is excluded."""
        resolved_source = source_path.resolve(strict=True)
        if resolved_source.stat().st_size > MAX_BACKUP_BYTES:
            message = "La copia de seguridad supera el tamaño máximo admitido."
            raise ValueError(message)

        with TemporaryDirectory(
            prefix="issues-dashboard-import-",
            dir=self._database.path.parent,
        ) as temporary_directory:
            temporary_root = Path(temporary_directory)
            manifest = self._extract_and_validate_archive(
                resolved_source,
                temporary_root,
            )
            imported_database_path = temporary_root / DATABASE_ARCHIVE_NAME
            imported_preferences_path = temporary_root / PREFERENCES_ARCHIVE_NAME
            imported_database = SqliteDatabase(imported_database_path)
            imported_database.quick_check()
            imported_database.migrate()
            JsonPreferencesStore(imported_preferences_path).read()

            safety_backup = self._create_safety_backup()
            self._replace_local_files(
                imported_database_path,
                imported_preferences_path,
            )
            self._preferences_store.reload()

        return BackupImportResult(
            source_account=self._optional_text(manifest.get("sourceAccount")),
            created_at=str(manifest["createdAt"]),
            schema_version=self._database.schema_version(),
            safety_backup_path=str(safety_backup),
        )

    def inspect_backup(self, source_path: Path) -> BackupInspection:
        """Validate a backup and expose safe metadata without restoring it."""
        resolved_source = source_path.resolve(strict=True)
        if resolved_source.stat().st_size > MAX_BACKUP_BYTES:
            message = "La copia de seguridad supera el tamaño máximo admitido."
            raise ValueError(message)
        with TemporaryDirectory(
            prefix="issues-dashboard-inspect-",
            dir=self._database.path.parent,
        ) as temporary_directory:
            temporary_root = Path(temporary_directory)
            manifest = self._extract_and_validate_archive(
                resolved_source,
                temporary_root,
            )
            imported_database = SqliteDatabase(
                temporary_root / DATABASE_ARCHIVE_NAME,
            )
            imported_database.quick_check()
            JsonPreferencesStore(temporary_root / PREFERENCES_ARCHIVE_NAME).read()
        return BackupInspection(
            source_account=self._optional_text(manifest.get("sourceAccount")),
            created_at=str(manifest["createdAt"]),
            schema_version=int(manifest["schemaVersion"]),
        )

    def _extract_and_validate_archive(
        self,
        source_path: Path,
        destination_root: Path,
    ) -> dict[str, object]:
        """Extract only expected archive members and validate their checksums."""
        expected_names = {
            MANIFEST_ARCHIVE_NAME,
            DATABASE_ARCHIVE_NAME,
            PREFERENCES_ARCHIVE_NAME,
        }
        try:
            with zipfile.ZipFile(source_path, mode="r") as archive:
                archive_names = set(archive.namelist())
                if archive_names != expected_names:
                    message = "La copia no contiene exactamente los archivos esperados."
                    raise ValueError(message)
                expanded_size = sum(item.file_size for item in archive.infolist())
                if expanded_size > MAX_BACKUP_BYTES:
                    message = "La copia descomprimida supera el tamaño máximo admitido."
                    raise ValueError(message)
                for archive_name in expected_names:
                    destination_path = destination_root / archive_name
                    with (
                        archive.open(archive_name) as source_handle,
                        destination_path.open("wb") as destination_handle,
                    ):
                        shutil.copyfileobj(source_handle, destination_handle)
        except zipfile.BadZipFile as error:
            message = "El archivo seleccionado no es una copia válida."
            raise ValueError(message) from error

        raw_manifest = self._read_manifest(destination_root)
        if not isinstance(raw_manifest, dict):
            message = "El manifiesto de la copia de seguridad no es válido."
            raise TypeError(message)
        manifest = dict(raw_manifest)
        self._validate_manifest(manifest, destination_root)
        return manifest

    @staticmethod
    def _read_manifest(destination_root: Path) -> object:
        """Decode the JSON manifest from an extracted backup."""
        try:
            return json.loads(
                (destination_root / MANIFEST_ARCHIVE_NAME).read_text(
                    encoding="utf-8",
                ),
            )
        except (OSError, json.JSONDecodeError) as error:
            message = "El manifiesto de la copia de seguridad no es válido."
            raise ValueError(message) from error

    @staticmethod
    def _validate_manifest(
        manifest: dict[str, object],
        destination_root: Path,
    ) -> None:
        """Validate backup compatibility and extracted checksums."""
        if manifest.get("formatVersion") != BACKUP_FORMAT_VERSION:
            message = "La versión del formato de copia no es compatible."
            raise ValueError(message)
        schema_version = manifest.get("schemaVersion")
        if (
            not isinstance(schema_version, int)
            or schema_version > CURRENT_SCHEMA_VERSION
        ):
            message = "La copia procede de una versión más reciente de la aplicación."
            raise ValueError(message)
        if not isinstance(manifest.get("createdAt"), str):
            message = "La copia no contiene una fecha de creación válida."
            raise TypeError(message)

        checksums = manifest.get("files")
        if not isinstance(checksums, dict):
            message = "La copia no contiene checksums válidos."
            raise TypeError(message)
        for archive_name in (DATABASE_ARCHIVE_NAME, PREFERENCES_ARCHIVE_NAME):
            expected_checksum = checksums.get(archive_name)
            if not isinstance(expected_checksum, str) or not hmac.compare_digest(
                expected_checksum,
                _sha256(destination_root / archive_name),
            ):
                message = f"El archivo {archive_name} está dañado."
                raise ValueError(message)

    def _create_safety_backup(self) -> Path:
        """Create and rotate automatic pre-restore backups."""
        backup_directory = self._database.path.parent / "backups"
        backup_directory.mkdir(parents=True, exist_ok=True)
        backup_path = backup_directory / _safe_backup_name("pre-restore")
        self.export_backup(backup_path)
        backups = sorted(
            backup_directory.glob(f"pre-restore-*{BACKUP_FILE_EXTENSION}"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        for obsolete_backup in backups[AUTOMATIC_BACKUP_LIMIT:]:
            obsolete_backup.unlink(missing_ok=True)
        return backup_path

    def _replace_local_files(
        self,
        imported_database_path: Path,
        imported_preferences_path: Path,
    ) -> None:
        """Replace data and preferences with rollback on any failure."""
        self._database.checkpoint()
        rollback_database = self._database.path.with_suffix(".restore-rollback")
        rollback_preferences = self._preferences_store.path.with_suffix(
            ".restore-rollback",
        )
        rollback_database.unlink(missing_ok=True)
        rollback_preferences.unlink(missing_ok=True)
        shutil.copy2(self._database.path, rollback_database)
        if self._preferences_store.path.exists():
            shutil.copy2(self._preferences_store.path, rollback_preferences)
        try:
            shutil.copy2(imported_database_path, self._database.path)
            shutil.copy2(imported_preferences_path, self._preferences_store.path)
            for suffix in ("-wal", "-shm"):
                Path(f"{self._database.path}{suffix}").unlink(missing_ok=True)
            self._database.quick_check()
        except Exception:
            shutil.copy2(rollback_database, self._database.path)
            if rollback_preferences.exists():
                shutil.copy2(rollback_preferences, self._preferences_store.path)
            raise
        finally:
            rollback_database.unlink(missing_ok=True)
            rollback_preferences.unlink(missing_ok=True)

    @staticmethod
    def _normalize_destination(destination_path: Path) -> Path:
        """Return an absolute destination with the canonical extension."""
        resolved_path = destination_path.expanduser().resolve()
        if not str(resolved_path).endswith(BACKUP_FILE_EXTENSION):
            return Path(f"{resolved_path}{BACKUP_FILE_EXTENSION}")
        return resolved_path

    @staticmethod
    def _optional_text(value: object) -> str | None:
        """Return optional non-empty manifest text."""
        return value if isinstance(value, str) and value.strip() else None


__all__ = [
    "BACKUP_FILE_EXTENSION",
    "BackupImportResult",
    "BackupInspection",
    "BackupManifestContext",
    "DashboardBackupService",
]
