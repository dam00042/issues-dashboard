"""Run the packaged FastAPI application."""

from __future__ import annotations

import os

import uvicorn

from dashboard_api.app.main import app

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8010


def main() -> None:
    """Start the FastAPI application server."""
    configured_port = os.getenv("DASHBOARD_API_PORT") or str(DEFAULT_PORT)
    configured_host = os.getenv("DASHBOARD_API_HOST", DEFAULT_HOST)
    port = int(configured_port)
    uvicorn.run(
        app,
        host=configured_host,
        port=port,
        reload=False,
    )


if __name__ == "__main__":
    main()
