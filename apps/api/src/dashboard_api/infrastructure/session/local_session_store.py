"""Persist a local encrypted GitHub session for development."""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import TYPE_CHECKING

from nacl import secret, utils
from nacl.exceptions import CryptoError

from dashboard_api.shared.time import utc_now_iso

if TYPE_CHECKING:
    from pathlib import Path

SESSION_FILE_VERSION = 1


def _to_base64(value: bytes) -> str:
    return base64.b64encode(value).decode("utf-8")


def _from_base64(value: str) -> bytes:
    return base64.b64decode(value.encode("utf-8"))


def _harden_file_permissions(file_path: Path) -> None:
    try:
        file_path.chmod(0o600)
    except OSError:
        # Best effort only. Windows ACLs may ignore POSIX chmod flags.
        return


@dataclass(frozen=True, slots=True)
class StoredGitHubSession:
    """Represent one persisted local GitHub session."""

    username: str
    updated_at: str


class LocalGitHubSessionStore:
    """Read and write the development GitHub session on disk."""

    def __init__(self, session_path: Path, key_path: Path) -> None:
        """Store the session and master-key file paths."""
        self._session_path = session_path
        self._key_path = key_path

    def read_session(self) -> StoredGitHubSession | None:
        """Return the stored session metadata when available."""
        payload = self._read_payload()

        if payload is None:
            return None

        return StoredGitHubSession(
            username=str(payload["username"]),
            updated_at=str(payload["updatedAt"]),
        )

    def read_token(self) -> str:
        """Decrypt and return the stored GitHub token."""
        payload = self._read_payload()

        if payload is None:
            return ""

        key = self._read_key()
        if key is None:
            return ""

        try:
            box = secret.SecretBox(key)
            decrypted = box.decrypt(
                _from_base64(str(payload["encryptedToken"])),
                _from_base64(str(payload["nonce"])),
            )
        except (CryptoError, ValueError, TypeError):
            return ""

        return decrypted.decode("utf-8")

    def write_session(self, username: str, token: str) -> StoredGitHubSession:
        """Encrypt and persist the provided GitHub session."""
        self._session_path.parent.mkdir(parents=True, exist_ok=True)
        self._key_path.parent.mkdir(parents=True, exist_ok=True)

        key = self._get_or_create_key()
        nonce = utils.random(secret.SecretBox.NONCE_SIZE)
        encrypted_token = secret.SecretBox(key).encrypt(token.encode("utf-8"), nonce)
        updated_at = self._utc_now()
        payload = {
            "encryptedToken": _to_base64(encrypted_token.ciphertext),
            "nonce": _to_base64(nonce),
            "updatedAt": updated_at,
            "username": username,
            "version": SESSION_FILE_VERSION,
        }

        self._session_path.write_text(
            json.dumps(payload, indent=2),
            encoding="utf-8",
        )
        _harden_file_permissions(self._session_path)
        return StoredGitHubSession(username=username, updated_at=updated_at)

    def clear_session(self) -> None:
        """Remove the persisted session and its local key material."""
        self._session_path.unlink(missing_ok=True)
        self._key_path.unlink(missing_ok=True)

    def _get_or_create_key(self) -> bytes:
        """Return the stored key or create a new one."""
        existing_key = self._read_key()
        if existing_key is not None:
            return existing_key

        new_key = utils.random(secret.SecretBox.KEY_SIZE)
        self._key_path.write_text(_to_base64(new_key), encoding="utf-8")
        _harden_file_permissions(self._key_path)
        return new_key

    def _read_key(self) -> bytes | None:
        """Return the stored encryption key when available."""
        if not self._key_path.exists():
            return None

        try:
            raw_key = self._key_path.read_text(encoding="utf-8").strip()
        except OSError:
            return None

        if not raw_key:
            return None

        try:
            return _from_base64(raw_key)
        except (ValueError, TypeError):
            return None

    def _read_payload(self) -> dict[str, object] | None:
        """Return the raw session payload when available and supported."""
        if not self._session_path.exists():
            return None

        try:
            payload = json.loads(self._session_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

        if not isinstance(payload, dict):
            return None

        if payload.get("version") != SESSION_FILE_VERSION:
            return None

        return payload

    @staticmethod
    def _utc_now() -> str:
        """Return the current UTC timestamp in ISO-8601 format."""
        return utc_now_iso()


__all__ = ["LocalGitHubSessionStore", "StoredGitHubSession"]
