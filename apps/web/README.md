# Dashboard Web UI

Static Next.js App Router frontend for Issues Dashboard. It is used in browser development and is bundled into Electron for production.

## Commands

```powershell
npm run dev --workspace @dashboard/web
npm run lint --workspace @dashboard/web
npm run test --workspace @dashboard/web
npm run build --workspace @dashboard/web
```

Running `npm run dev` from the repository root starts the frontend at `http://127.0.0.1:3000` together with the API at `http://127.0.0.1:17632`. The launcher reads local port overrides before inherited terminal variables and injects the same API endpoint into both workspaces. Next.js owns its development lock and reports occupied ports without replacing a running instance.

## Runtime rules

- The browser talks only to the local FastAPI service.
- Snapshot and PR reads are cache-only.
- The unified refresh button and configured automatic interval call the same synchronization endpoint.
- Heavy issue details are loaded lazily from SQLite when an issue is selected.
- User preferences are persisted by the API and included in complete backups; `localStorage` is not used as operational storage.
- Electron capabilities are exposed only through the typed preload bridge in `src/types/desktop.d.ts`.
