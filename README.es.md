# Issues Dashboard

![Issues Dashboard](docs/images/hero-dashboard.png)

Espacio local-first para priorizar y gestionar incidencias asignadas en GitHub, disponible tanto en web como en escritorio.

English documentation is available in [README.md](README.md).

## Índice

1. [Resumen](#resumen)
2. [Características principales](#características-principales)
3. [Arquitectura](#arquitectura)
4. [Modos de ejecución](#modos-de-ejecución)
5. [Resumen de la API](#resumen-de-la-api)
6. [Configuración](#configuración)
7. [Puesta en marcha](#puesta-en-marcha)
8. [Comandos de calidad](#comandos-de-calidad)
9. [Empaquetado de escritorio (Windows)](#empaquetado-de-escritorio-windows)
10. [Modelo de seguridad](#modelo-de-seguridad)
11. [Resolución de problemas](#resolución-de-problemas)

## Resumen

Issues Dashboard está pensado para personas desarrolladoras que necesitan clasificar rápidamente las incidencias de GitHub que tienen asignadas.

El proyecto combina:

- Un frontend en Next.js para priorización y edición de notas.
- Un backend en FastAPI que fusiona datos de GitHub con estado local.
- Un contenedor de escritorio con Electron que integra backend y persistencia local.

La aplicación es local-first por diseño: la prioridad, notas, completado y metadatos de cada incidencia se guardan en SQLite local, de forma que el flujo de trabajo sigue siendo útil incluso cuando GitHub no responde temporalmente.

## Características principales

- Tablero por prioridad (Backlog, P1-P4 y sección de completadas).
- Estado local por incidencia:
  - prioridad
  - fijado
  - completada
  - bloques de notas estructurados
- Sincronización incremental con actualizaciones optimistas en la UI.
- Filtro de ventana de incidencias cerradas (`1`, `3`, `6`, `12` o `all` meses).
- Gestión de sesión local de GitHub.
- Controles de escritorio para exportar e importar la base de datos SQLite.

## Arquitectura

## Estructura del monorepo

```text
apps/
  api/       FastAPI + capas domain/application/infrastructure
  web/       UI con Next.js App Router
  desktop/   Electron y scripts de empaquetado
scripts/     utilidades de orquestación en raíz
```

## Backend (`apps/api`)

El backend sigue un diseño por capas:

- `dashboard_api/app`
  - Punto de composición de FastAPI (`create_app`), inyección de dependencias, CORS y ciclo de vida.
- `dashboard_api/application`
  - Servicios de caso de uso para snapshots, comandos de estado local y sesión.
- `dashboard_api/domain`
  - Modelos de dominio y valores por defecto para incidencias y notas.
- `dashboard_api/infrastructure`
  - Cliente REST de GitHub (`httpx`), repositorio SQLite y almacén local cifrado de sesión.
- `dashboard_api/presentation/http`
  - Rutas HTTP y esquemas Pydantic de entrada/salida.

Flujo de una carga de snapshot:

1. El frontend solicita `GET /api/issues/snapshot?closed_window=...`.
2. `IssueDashboardSnapshotService` intenta refrescar contra GitHub si hay credenciales válidas.
3. `SqliteTrackedIssueRepository` actualiza la proyección remota y fusiona el estado local.
4. La API devuelve un payload normalizado (`issues` + `meta`) para renderizado.

Si GitHub no está disponible, el servicio cae a caché local en lugar de fallar de forma abrupta.

## Frontend (`apps/web`)

El frontend es una aplicación Next.js orientada a velocidad de triage:

- `src/features/issues-dashboard/dashboard-app.tsx`
  - Estado principal de orquestación (sesión, carga de snapshot, cola de sincronización, filtros).
- `src/features/issues-dashboard/dashboard-board.tsx`
  - Tablero, carriles, interacciones drag/drop y acciones de prioridad.
- `src/features/issues-dashboard/dashboard-chrome.tsx`
  - Chrome estilo escritorio, pantalla de sesión y modal de descripción.
- `src/features/issues-dashboard/api.ts`
  - Capa cliente HTTP para consumir la API.

Modelo de interacción:

- Lee snapshots del backend.
- Aplica cambios optimistas en UI.
- Sincroniza mutaciones mediante endpoints dedicados (`priority`, `pin`, `completion`, `notes`, `sync-state`).

## Escritorio (`apps/desktop`)

Electron cubre responsabilidades nativas sin duplicar lógica de interfaz:

- `main.cjs`
  - Crea ventana, controla el ciclo de vida del backend embebido, registra eventos y gestiona IPC.
- `preload.cjs`
  - Expone un bridge restringido en `window.githubIssuesDesktop`.
- `session-store.cjs`
  - Cifra el payload de sesión para ejecución de escritorio.

Flujo de arranque en escritorio:

1. Electron reserva un puerto local para la API.
2. Crea `BrowserWindow` pasando `--api-base-url`.
3. Si existe sesión local, arranca el backend embebido y espera `GET /health`.
4. El frontend consume la API mediante la URL inyectada por preload/main.

## Modos de ejecución

## 1) Modo web (API + Web)

Úsalo para desarrollo en navegador.

- `npm run dev`
  - Arranca `@dashboard/api` y `@dashboard/web` mediante Turbo.
  - Resuelve un puerto libre para API e inyecta `NEXT_PUBLIC_API_BASE_URL`.

## 2) Modo escritorio (Web + Electron + API embebida)

Úsalo para validar comportamiento desktop, IPC y empaquetado.

- `npm run dev:desktop`
  - Arranca `@dashboard/web` y `@dashboard/desktop`.
  - El backend se ejecuta como proceso local gestionado por Electron.

## Resumen de la API

La base URL se determina en runtime (`http://127.0.0.1:<puerto>` en local).

Rutas de incidencias:

- `GET /api/issues/snapshot`
- `POST /api/issues/sync-state`
- `PATCH /api/issues/state`
- `PATCH /api/issues/priority`
- `PATCH /api/issues/pin`
- `PUT /api/issues/completion`
- `PUT /api/issues/notes`

Rutas de sesión:

- `GET /api/session/status`
- `POST /api/session`
- `DELETE /api/session`

Ruta de salud:

- `GET /health`

## Configuración

Variables de entorno más relevantes:

- `DASHBOARD_API_PORT`
  - Puerto de escucha de la API (por defecto: `8010`; dinámico en orquestación web).
- `NEXT_PUBLIC_API_BASE_URL`
  - URL base de API para el frontend (normalmente inyectada por scripts).
- `GITHUB_TOKEN`
  - Token opcional de respaldo cuando no hay sesión local guardada.
- `GITHUB_USERNAME`
  - Usuario opcional asociado al `GITHUB_TOKEN`.
- `ISSUES_DATABASE_PATH`
  - Ruta del archivo SQLite con incidencias.
- `GITHUB_SESSION_PATH`
  - Ruta de metadatos de sesión cifrada.
- `GITHUB_SESSION_KEY_PATH`
  - Ruta de la clave local de cifrado para sesión de backend.

`apps/api/.env.local` y `apps/web/.env.local` están ignorados por git para configuración local.

## Puesta en marcha

Requisitos:

- Node.js 22+
- npm 10+
- Python 3.13+
- `uv` (`python -m pip install uv`)

Instalación y preparación del entorno backend:

```bash
npm install
npm run backend:venv
npm run backend:sync
```

Ejecución en modo web:

```bash
npm run dev
```

Ejecución en modo escritorio:

```bash
npm run dev:desktop
```

## Comandos de calidad

Ejecución completa de validaciones:

```bash
npm run verify
```

Comandos individuales:

```bash
npm run lint
npm run test
npm run build
```

Comandos solo de backend:

```bash
npm run backend:dev
npm run backend:test
npm run backend:lint
npm run backend:format
```

## Empaquetado de escritorio (Windows)

Construcción completa de distribución desktop:

```bash
npm run build:desktop
```

Salida esperada:

```text
apps/desktop/release/GitHub Issues Dashboard-win32-x64/GitHub Issues Dashboard.exe
```

Para distribuir en GitHub Releases, empaqueta la carpeta:

```text
apps/desktop/release/GitHub Issues Dashboard-win32-x64/
```

## Modelo de seguridad

- Los archivos de entorno local no se versionan.
- Los tokens de GitHub no se guardan en el repositorio.
- El almacén de sesión del backend (`apps/api`) cifra tokens con NaCl (`SecretBox`) y clave local por equipo.
- El registro de sesión desktop usa `tweetnacl`; la clave maestra se envuelve con `safeStorage` de Electron cuando está disponible.
- Los datos de runtime (sesión y SQLite) se guardan en rutas locales de usuario.

## Resolución de problemas

- Conflictos de puertos en modo web:
  - El lanzador de desarrollo reintenta con un puerto libre para API.
  - El frontend usa por defecto `http://127.0.0.1:3000`.
- Backend no disponible en escritorio:
  - Verifica que exista sesión local desde la pantalla de inicio de sesión.
  - Revisa el log de ejecución (`desktop.log`) en el directorio de datos de usuario.
- Bloqueos de archivo en empaquetado de Windows:
  - Cierra cualquier ejecutable empaquetado que esté en ejecución.
  - Si falla el paso de icono, cierra vistas previas del Explorador y relanza build.

## Estado del proyecto

Este repositorio se mantiene actualmente como proyecto privado.
