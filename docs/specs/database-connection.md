# Spec: Database connection configuration

- **Status:** Accepted (implemented)
- **Date:** 2026-11-15
- **Related:** `docs/adrs/0001-hosting-cloud-run-neon-cloudflare.md`,
  `docs/specs/deploy-workflow.md`, `docs/specs/api-server-entry.md`,
  `docs/specs/database-integration-tests.md`, `.env.example`

## Goal

A deployed API process must fail immediately and clearly when `DATABASE_URL` is
missing, instead of silently targeting the local docker-compose database and
failing later with an unexplained connection error. A Postgres client that drops
while idle must be logged and discarded instead of crashing the process with an
unhandled `error` event.

## Scope

### In scope

1. `apps/api/src/db/connection.ts` owns the connection configuration:
   `resolveDatabaseUrl` turns an environment record into the effective
   connection string, and `createDatabasePool` builds the `pg.Pool` over it.
2. `resolveDatabaseUrl` treats an unset or empty `NODE_ENV`, `development` and
   `test` as development/test. Only those may fall back to
   `postgres://killingit:killingit@localhost:5432/killingit`; anywhere else a
   missing or blank `DATABASE_URL` throws.
3. The guard runs when `apps/api/src/db/index.ts` is imported, before the pool is
   constructed, so the process exits at startup rather than on the first query.
4. The TLS inference is unchanged: a connection string that does not name a
   loopback host and omits `sslmode` gains `sslmode=require`.
5. `createDatabasePool` attaches an `error` listener that logs
   `[db] idle client error:` followed by the error through `console.error`, and
   lets pg discard the client.

### Out of scope

- Lazy `getDb()` and dependency injection. The pool is still built at import and
  still connects lazily, so unit tests stay database-free.
- Changing the local fallback URL, the local docker-compose setup, or the
  drizzle-kit migration URL fallback in `apps/api/drizzle.config.ts`, which is a
  developer tool rather than the server.
- Sentry reporting for the pool error. This module is imported before Sentry is
  initialised and by every test process, so it logs and nothing more.

## Rules

- `resolveDatabaseUrl` is pure: it takes the environment record it reads and
  never touches `process.env`, so tests pass records instead of mutating the
  process environment.
- Neither the thrown error nor the log line includes the connection string,
  which carries credentials. The error names `DATABASE_URL` and the observed
  `NODE_ENV`.
- The configured value is trimmed; a blank value counts as missing.
- The pool error listener is added before the pool can connect.

## Data-model and API impact

None. No schema, migration, route or response changes. The only runtime change
is startup failure when the deployment omits `DATABASE_URL`, and an idle-client
error no longer terminating the process.

## Acceptance criteria

1. Importing `apps/api/src/db/index.ts` in a process with `NODE_ENV=production`
   and no `DATABASE_URL` exits non-zero with an error that names
   `DATABASE_URL`, and never prints a connection string.
2. In development and test (and with `NODE_ENV` unset or empty) the module still
   falls back to the local database, so `bun run dev`, `bun run test`,
   `bun run test:integration` and `bun run test:e2e` behave as before.
3. Hosted connection strings without `sslmode` still gain `?sslmode=require`,
   and loopback or already-qualified strings are left untouched.
4. A `Pool` built by `createDatabasePool` logs an emitted `error` under the
   `[db]` prefix and does not throw.
5. Typecheck, lint, format, unit tests, the unused-export check and the
   database-backed integration tests pass.
