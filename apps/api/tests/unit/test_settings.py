"""Test application settings path overrides."""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest import TestCase

from dashboard_api.settings import AppSettings


class AppSettingsTests(TestCase):
    """Verify explicit settings never fall back to development data paths."""

    def test_accepts_explicit_python_field_names_for_storage_paths(self) -> None:
        """Keep tests and custom runtimes isolated from local development data."""
        with tempfile.TemporaryDirectory() as temporary_directory:
            base_path = Path(temporary_directory)
            database_path = base_path / "issues.db"
            session_path = base_path / "session.json"
            session_key_path = base_path / "session.key"

            settings = AppSettings(
                github_session_key_path=session_key_path,
                github_session_path=session_path,
                issues_database_path=database_path,
            )

            if settings.issues_database_path != database_path:
                message = "Expected the explicit database path to be preserved."
                raise AssertionError(message)
            if settings.github_session_path != session_path:
                message = "Expected the explicit session path to be preserved."
                raise AssertionError(message)
            if settings.github_session_key_path != session_key_path:
                message = "Expected the explicit session key path to be preserved."
                raise AssertionError(message)
