"""Load environment-aware application settings."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_PATH = PROJECT_ROOT / "data" / "issues.db"
DEFAULT_SESSION_PATH = PROJECT_ROOT / "data" / "github-session.json"
DEFAULT_SESSION_KEY_PATH = PROJECT_ROOT / "data" / "github-session.key"


class AppSettings(BaseSettings):
    """Represent the runtime configuration for the API."""

    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env.local", PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    github_token: str = ""
    github_username: str = ""
    github_api_base_url: str = "https://api.github.com"
    github_request_timeout_seconds: float = 20.0
    github_max_pages: int = 10
    issues_database_path: Path = Field(
        default=DEFAULT_DATABASE_PATH,
        validation_alias=AliasChoices("ISSUES_DATABASE_PATH", "ISSUES_DB_PATH"),
    )
    github_session_path: Path = Field(
        default=DEFAULT_SESSION_PATH,
        validation_alias=AliasChoices("GITHUB_SESSION_PATH", "SESSION_PATH"),
    )
    github_session_key_path: Path = Field(
        default=DEFAULT_SESSION_KEY_PATH,
        validation_alias=AliasChoices(
            "GITHUB_SESSION_KEY_PATH",
            "SESSION_KEY_PATH",
        ),
    )
    cors_origins: tuple[str, ...] = (
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "null",
    )

    @field_validator("issues_database_path", mode="before")
    @classmethod
    def resolve_database_path(cls, value: object) -> Path:
        """Resolve the configured database path relative to the project root."""
        raw_path = Path(str(value))
        resolved_path = raw_path if raw_path.is_absolute() else PROJECT_ROOT / raw_path
        resolved_path.parent.mkdir(parents=True, exist_ok=True)
        return resolved_path

    @field_validator("github_session_path", "github_session_key_path", mode="before")
    @classmethod
    def resolve_session_paths(cls, value: object) -> Path:
        """Resolve the configured session paths relative to the project root."""
        raw_path = Path(str(value))
        resolved_path = raw_path if raw_path.is_absolute() else PROJECT_ROOT / raw_path
        resolved_path.parent.mkdir(parents=True, exist_ok=True)
        return resolved_path


@lru_cache(maxsize=1)
def get_settings() -> AppSettings:
    """Return a cached application settings instance."""
    return AppSettings()
