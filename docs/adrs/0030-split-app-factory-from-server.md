# ADR 0030: Separate the API server entry point from the app factory

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** torhovland
- **Related:** `docs/specs/api-server-entry.md`,
  `docs/specs/api-dependency-wiring.md`

## Context

`apps/api/src/index.ts` was both the library that exports `createApp` and the
executable entry point. At module scope it loaded the developer's `.env`,
constructed a production app, and default-exported the Bun server
configuration. Ten test files import `createApp` from that module, so every
test run read local secrets and `DATABASE_URL`, initialised Sentry as a side
effect, and depended on whether a `.env` file happened to exist. That shadowed
missing-environment handling and made local and CI runs behave differently.
The comment on `createApp` already claimed tests stay DB-free, which the module
did not honour.

## Decision

- Keep `apps/api/src/index.ts` a side-effect-free library: it exports
  `createApp` and the dependency types, and does nothing else at import.
- Add `apps/api/src/server.ts` as the only executable. It loads the local
  environment file, calls `createApp()`, and default-exports the Bun server
  configuration.
- Point `bun run dev`, `bun run start`, the Docker build and runtime command,
  and Knip's production entry at `src/server.ts`.
- Tests build the app themselves with `createApp()` instead of importing a
  module-level instance.

## Alternatives considered

- **Guard `.env` loading with `NODE_ENV`.** Rejected: the import still builds
  the app and initialises Sentry, and an environment check keeps the coupling
  between tests and the startup path.
- **Export a lazily initialised app singleton from `index.ts`.** Rejected: it
  keeps configuration loading in the factory module and gives tests an
  implicitly shared app instead of explicit injection.
- **Load `.env` from a side-effect module imported by `server.ts`.** Rejected:
  it adds a module for a few lines and hides when configuration is read; the
  conventional `server.ts` entry keeps the startup sequence in one place.

## Consequences

- Importing `createApp` cannot leak a developer's environment into a test
  process, and Sentry is initialised only when the server builds the app.
- The executable lives in `server.ts`; deployments and scripts must refer to
  it, and `src/index.ts` is no longer a Bun entry point.
- Module-level `process.env` reads in route and store modules are unchanged.
  The Postgres pool still exists on import but connects lazily, so in-process
  tests remain DB-free without a second refactor.
