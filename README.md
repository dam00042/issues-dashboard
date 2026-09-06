# Issues Dashboard

![Issues Dashboard](docs/images/hero-dashboard.png)

Local-first desktop workspace for GitHub issues, Projects fields, Pull Requests, priorities, and private notes. The production target is a self-contained Windows application; browser mode exists for development and review.

Spanish documentation: [README.es.md](README.es.md).

## What it includes

- Assigned GitHub issues, excluding Epics.
- Separate GitHub issue state (`Open`/`Closed`) and Projects `Status`.
- Dynamic filters for Status, Sprint, and Priority.
- Local priority board, pinning, review/completion workflow, and structured notes.
- Pull Request dashboard split into authored and review-requested work, with independent state filters.
- SQLite cache that opens instantly and is refreshed only through an explicit or scheduled synchronization.
- One portable backup containing the database and user preferences.
- Electron-owned GitHub token encrypted with the operating system credential facilities.

## Architecture

```text
apps/
  api/       FastAPI use cases, GitHub adapters, SQLite, migrations, backups
  web/       Next.js static UI, HeroUI, optimistic local interactions
  desktop/   Electron TypeScript runtime and deterministic Windows packaging
scripts/     monorepo development orchestration
```

The UI never calls GitHub directly. Reads use the local API and SQLite cache. `POST /api/synchronization` is the only dashboard-wide remote refresh command; it updates issues, the three required Projects fields, linked PRs, and the PR dashboard in one non-overlapping operation.

SQLite uses WAL mode, short-lived connections, indexed normalized projections, conditional upserts, and schema migrations. Existing JSON projections are backfilled into the normalized tables during upgrade without requiring a GitHub refresh.

## GitHub token

The app asks only for a token and resolves the real GitHub login through `/user`; no account name is hardcoded or manually persisted as configuration.

With GitHub CLI, authenticate the intended account and grant read-only Projects access:

```powershell
gh.exe auth switch --hostname github.com --user YOUR_ACCOUNT
gh.exe auth refresh --hostname github.com --scopes read:project
gh.exe auth status --hostname github.com
gh.exe auth token --hostname github.com --user YOUR_ACCOUNT
```

The token also needs access to the repositories whose issues and Pull Requests should be shown. Treat it as a password and never place it in a committed file.

## Setup

Requirements:

- Node.js 22+
- npm 10+
- Python 3.13+
- `uv` available as a Python module (`python -m pip install uv`)

```powershell
npm install
npm run backend:venv
npm run backend:sync
```

The repository scripts automatically use `apps/api/.venv/Scripts/python.exe` once it exists, so the regular commands work consistently from PowerShell, CMD, and VS Code.

## Run modes

Browser development (FastAPI + Next.js):

```powershell
npm run dev
```

- UI: `http://127.0.0.1:3000`
- API: the launcher selects port `8010` when available and otherwise chooses a free local port.

Desktop development (Next.js + Electron-managed FastAPI):

```powershell
npm run dev:desktop
```

Production desktop package:

```powershell
npm run build:desktop
```

Output:

```text
apps/desktop/release/GitHub Issues Dashboard-win32-x64/GitHub Issues Dashboard.exe
```

The package always rebuilds the static web UI and the PyInstaller `onedir` API before assembling Electron, preventing mixed or stale artifacts.

## Quality commands

```powershell
npm run format:check
npm run lint
npm run test
npm run verify
```

`npm run verify` also produces the complete desktop package.

## Configuration

Copy [apps/api/.env.example](apps/api/.env.example) to `apps/api/.env.local` only when browser development needs overrides. Electron supplies its own random port, runtime secret, database path, preferences path, and encrypted session token at runtime.

Important variables:

- `DASHBOARD_API_HOST`, `DASHBOARD_API_PORT`: local API listener.
- `GITHUB_TOKEN`: optional browser-development token fallback.
- `GITHUB_API_BASE_URL`: GitHub API URL, useful for tests or GitHub Enterprise.
- `GITHUB_REQUEST_TIMEOUT_SECONDS`, `GITHUB_MAX_PAGES`: bounded remote work.
- `ISSUES_DATABASE_PATH`: SQLite database path.
- `DASHBOARD_PREFERENCES_PATH`: portable JSON preferences path.
- `GITHUB_SESSION_PATH`, `GITHUB_SESSION_KEY_PATH`: encrypted browser-development session paths.
- `DASHBOARD_DESKTOP_MODE`, `DASHBOARD_RUNTIME_SECRET`: Electron-only local API protection.
- `NEXT_PUBLIC_API_BASE_URL`: browser UI API endpoint; normally injected by the launcher.

There are no Turso/libSQL or cloud deployment variables because this branch intentionally targets a local desktop application.

## API summary

- `GET /health`: liveness plus API, contract, and schema versions.
- `GET /api/issues/snapshot?compact=true`: lightweight SQLite snapshot.
- `GET /api/issues/{issue_key}`: full local issue detail.
- `POST /api/synchronization`: unified GitHub refresh.
- `GET /api/synchronization/status`: local synchronization status.
- `GET /api/github/pull-requests`: cached PR projection filtered by history window.
- `GET|PUT /api/preferences`: portable settings.
- `POST /api/backups/export|inspect|import`: complete validated backups.
- `/api/issues/*`: intent-based local priority, pin, completion, and notes mutations.
- `/api/session/*`: encrypted session support used only by browser development.

## Persistence and backups

The desktop runtime stores machine data under Electron's user-data directory:

- `issues.db`: issues, project fields, Pull Requests, reviewers, and local workflow state.
- `preferences.json`: theme, zoom, history windows, refresh interval, and sidebar state.
- `session.json`: token encrypted by Electron `safeStorage` and tagged with its resolved login.
- `window-state.json`: machine-specific window position and size; intentionally not portable.
- `desktop.log` and `desktop.log.1`: bounded diagnostic logs.

An `.issues-dashboard-backup` file contains an online SQLite snapshot, preferences, a versioned manifest, and SHA-256 checksums. Import validates size, checksums, schema, preferences, and SQLite integrity before replacement, warns on account mismatch, and creates a recoverable pre-restore backup.

## Security and reliability

- Electron is the sole owner of the production token; the renderer never receives it.
- The embedded API binds to loopback and requires a random per-run header secret on every non-health request.
- The preload exposes a narrow, context-isolated IPC bridge; Node integration is disabled.
- Electron validates the bundled API contract before showing the application and restarts a crashed backend a bounded number of times.
- GitHub requests use connection pooling, bounded history, ETags for REST issue pages, short in-memory GraphQL caches, and query only fields displayed by the app.
- GitHub failures preserve the last valid SQLite projection and are reported through UI toasts.

## Troubleshooting

- If Projects fields are missing, run the `gh.exe auth refresh ... --scopes read:project` command above and paste the refreshed token into the app.
- If PowerShell opens an application chooser for `gh`, call `gh.exe` explicitly.
- Desktop runtime diagnostics are in `desktop.log` inside the Electron user-data directory.
- Close a running packaged executable before rebuilding if Windows reports locked files.
