# Dashboard API

Local FastAPI service for Issues Dashboard. It owns SQLite, GitHub synchronization, browser-development sessions, preferences, and complete backups.

## Commands

From the repository root:

```powershell
npm run backend:dev
npm run backend:lint
npm run backend:test
```

The scripts use `uv run --frozen` with the workspace lockfile and the single environment at `apps/api/.venv`. See [`../../README.md`](../../README.md) for setup and runtime configuration.

## Design boundaries

- Cache reads never call GitHub.
- `POST /api/synchronization` is the single remote synchronization command.
- SQLite migrations are forward-only and checked through `PRAGMA user_version`.
- Remote projections use conditional upserts; local notes and workflow state are not replaced by refreshes.
- Desktop requests require the per-run runtime secret, except for `/health`.
- Desktop tokens are owned by Electron; the API session endpoints only support browser development.

Code is grouped by responsibility:
- `app.py` creates FastAPI and wires its dependencies.
- `issues/` contains issue models, defaults, and local-first operations.
- `github/` contains the remote clients.
- `persistence/` contains SQLite migrations, repositories, and encrypted development sessions.
- `preferences.py` owns preference defaults, validation, caching, and atomic JSON storage.
- `backups.py`, `session.py`, and `synchronization.py` implement their respective operations.
- `http/` contains schemas, request parsing, and routes.

There are no forwarding services or compatibility packages for the former layers. The Python launcher is `scripts/python-runtime.cjs`; it shares the same uv environment with development, checks, and packaging. `scripts/build-exe.cjs` is only used for explicit desktop packaging.
