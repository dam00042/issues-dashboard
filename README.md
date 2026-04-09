# Issues Dashboard

![Issues Dashboard](docs/images/hero-dashboard.png)

Aplicacion local-first para gestionar issues asignadas de GitHub en web y desktop.

## Que incluye

- Tablero por prioridades con backlog y panel de detalle.
- Persistencia local por issue (prioridad, fijado, completada y notas).
- App desktop con backend embebido.
- Build para Windows en formato exe.

## Estructura

```text
apps/
  api/       FastAPI + SQLite
  web/       Next.js
  desktop/   Electron
```

## Requisitos

- Node.js 22+
- Python 3.13+
- uv
- Windows para generar el exe

## Arranque rapido

```bash
npm install
npm run backend:venv
npm run backend:sync
npm run dev:desktop
```

## Build desktop (exe)

```bash
npm run build:desktop
```

Salida esperada:

```text
apps/desktop/release/GitHub Issues Dashboard-win32-x64/GitHub Issues Dashboard.exe
```

## Seguridad

- No se versionan credenciales locales.
- apps/api/.env.local esta ignorado por git.
- apps/web/.env.local esta ignorado por git.
- El token de GitHub se mantiene en almacenamiento local de runtime, no en el repo.

## Publicacion

Este repo esta pensado para mantenerse privado por ahora.

Si quieres compartir binarios, sube a GitHub Release el contenido generado en:

```text
apps/desktop/release/GitHub Issues Dashboard-win32-x64/
```
