# Spec: Database-backed integration tests

- **Status:** Accepted (implemented)
- **Date:** 2026-11-09
- **Related:** `AGENTS.md` (Development Methodology), issue #164,
  `docs/specs/coach-plan-lifecycle.md`, `docs/specs/versioned-athlete-questions.md`,
  `docs/specs/account-deletion.md`.

## Goal

Exercise the Drizzle queries and database constraints against a real
PostgreSQL instance, so a change to a store, a schema constraint, a migration,
or the plan-save transaction cannot pass CI while being broken at runtime.

## Scope

### In scope

1. A separate integration suite that connects to a test database, applies every
   migration to an empty schema, and truncates between tests.
2. Coverage of the stores and lifecycle that unit tests cannot reach:
   - the `coach_plans_user_id_idx` unique constraint and plan upsert;
   - `plan_week_totals` and `plan_day_calories` writes inside the plan
     transaction, including rollback when the transaction fails;
   - run fencing in `plan_generations` (`begin`, `isCurrent`, `update`,
     `heartbeat`, `finish`, `fail`) and a superseded run's late save;
   - question versioning, answer upserts and replacement, previous-response
     resolution, and survey adjustments;
   - `ON DELETE CASCADE` cleanup when an account is deleted.
3. A dedicated CI job that starts PostgreSQL, applies the migrations through the
   suite itself, and runs the suite.

### Out of scope

- HTTP route tests. Routes keep their injected-store unit tests; this suite
  tests the PostgreSQL-backed stores directly.
- A production database. The suite refuses to run unless the target database
  name ends in `_test`.
- Test containers or an in-process Postgres. CI and local development use the
  existing `docker-compose.yml` database, with a separate test database.

## Behaviour

### Test database

- The suite uses `INTEGRATION_DATABASE_URL` when set, otherwise
  `postgres://killingit:killingit@localhost:5432/killingit_test`.
- It creates the test database if it is missing, then drops the `public` and
  `drizzle` schemas and runs every migration from `apps/api/drizzle`. This is
  the assertion that all migrations apply to an empty database.
- Before each test, every `public` table is truncated with
  `RESTART IDENTITY CASCADE`, so tests are isolated and repeatable.
- Unit tests stay in `bun test src`; the integration suite lives outside `src`
  and runs with `bun run test:integration`.

### CI

A `integration` job in `.github/workflows/ci.yml` uses the
`postgres:16-alpine` service, installs dependencies, and runs
`bun run test:integration` with `INTEGRATION_DATABASE_URL` pointing at the
service. The job runs alongside the existing typecheck, lint, format, and unit
test jobs.

## Data-model and API impact

None. The suite only reads and writes existing tables through the existing
stores.

## Acceptance criteria

- `bun run test:integration` passes locally against the docker-compose
  PostgreSQL after `bun run db:up`.
- The suite fails if a migration does not apply, a constraint is dropped, a
  store stops writing its companion rows, or run fencing stops rejecting a
  superseded save.
- `bun run test` remains database-free and does not run the integration suite.
- CI runs the integration suite in its own job.
