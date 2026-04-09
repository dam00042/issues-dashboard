"""Run the FastAPI application in development mode."""

from __future__ import annotations

import os

import uvicorn

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8010


def parse_reload_flag() -> bool:
    """Return whether the development server should auto-reload."""
    raw_value = os.getenv("DASHBOARD_API_RELOAD", "1").strip().lower()
    return raw_value not in {"0", "false", "no", "off"}


def main() -> None:
    """Start the FastAPI development server with a configurable port."""
    configured_port = os.getenv("DASHBOARD_API_PORT") or str(DEFAULT_PORT)
    configured_host = os.getenv("DASHBOARD_API_HOST", DEFAULT_HOST)

    uvicorn.run(
        "dashboard_api.app.main:app",
        host=configured_host,
        port=int(configured_port),
        reload=parse_reload_flag(),
    )


if __name__ == "__main__":
    main()
