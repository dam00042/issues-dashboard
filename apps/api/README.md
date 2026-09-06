# Dashboard API

Local FastAPI service for Issues Dashboard. It owns SQLite, GitHub synchronization, browser-development sessions, preferences, and complete backups.

## Commands

From the repository root:

```powershell
npm run backend:dev
npm run backend:lint
npm run backend:test
```

The scripts use the workspace `.venv` automatically. See [`../../README.md`](../../README.md) for setup and runtime configuration.

## Design boundaries

- Cache reads never call GitHub.
- `POST /api/synchronization` is the single remote synchronization command.
- SQLite migrations are forward-only and checked through `PRAGMA user_version`.
- Remote projections use conditional upserts; local notes and workflow state are not replaced by refreshes.
- Desktop requests require the per-run runtime secret, except for `/health`.
- Desktop tokens are owned by Electron; the API session endpoints only support browser development.

The main layers are `domain`, `application`, `infrastructure`, and `presentation/http`. `app/main.py` is the composition root.
