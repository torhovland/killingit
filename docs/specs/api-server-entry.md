# Spec: API app factory and server entry point

- **Status:** Accepted (implemented)
- **Date:** 2026-11-12
- **Related:** `docs/adrs/0030-split-app-factory-from-server.md`,
  `docs/specs/api-dependency-wiring.md`,
  `docs/specs/authenticated-user-middleware.md`

## Goal

Importing the API's app factory must not read a developer's `.env`, construct a
production app, or initialise Sentry. Tests and other in-process consumers
(the e2e server) import `createApp` from `apps/api/src/index.ts`, so module
import has to stay free of startup side effects. Loading local configuration and
building the app belong to the executable, which is a separate module.

## Scope

### In scope

1. `apps/api/src/index.ts` exports `createApp` (and the dependency types) and
   nothing else runs at module scope. It no longer calls `process.loadEnvFile`
   or `createApp()`, and it no longer has a default server export.
2. `apps/api/src/server.ts` is the executable: it loads the local `.env` (repo
   root, then cwd), builds the app with `createApp()`, and default-exports the
   Bun server configuration (`port`, `hostname`, `idleTimeout`, `fetch`).
3. `bun run dev`, `bun run start`, the Docker build/runtime `COPY`/`CMD`, and
   the Knip production entry point use `src/server.ts`.
4. Tests that used the old default `app` export build their own app with
   `createApp()`.
5. A regression test imports `index.ts` in a child process with
   `process.loadEnvFile` instrumented and fails if it is called during import.

### Out of scope

- Making every route module lazy about configuration. Module-level
  `process.env` reads inside route and store modules are unchanged; none of
  them loads a file, and they run before the server loads `.env` exactly as
  they did before this change.
- Lazy creation of the Postgres pool in `db/index.ts`. It reads
  `DATABASE_URL` at import but does not connect, so tests stay DB-free.
- Changing the server configuration values or the deploy topology.

## Rules

- `apps/api/src/index.ts` is a library module: importing it may define
  functions and constants, but it must not touch the filesystem, call
  `process.loadEnvFile`, construct the app, or start a server.
- Only `apps/api/src/server.ts` loads environment files and builds the
  production app. A new executable entry point that needs configuration goes
  through `server.ts` rather than adding startup code back to `index.ts`.
- Tests construct the app through `createApp`, optionally injecting fakes, and
  never import a module-level singleton.
- `.env` loading remains a dev convenience: it looks for the repository root
  file first and falls back to the working directory, and it no-ops when
  neither exists (CI, Cloud Run).

## Acceptance criteria

1. Importing `apps/api/src/index.ts` calls neither `process.loadEnvFile` nor
   `createApp`.
2. Tests pass with no `.env` file present, and an existing `.env` is not read
   by an import of the app factory.
3. `bun run dev`, `bun run start`, the Docker image and the Knip entry point
   resolve `src/server.ts`.
4. `createApp` still builds the same app; the existing route, auth, version and
   e2e tests pass unchanged apart from replacing the removed default export.
5. Typecheck, lint, format, unit tests, and the unused-export check pass.
