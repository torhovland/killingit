# Spec: Database-backed integration tests

- **Status:** Accepted (implemented)
- **Date:** 2026-11-09
- **Related:** `AGENTS.md` (Development Methodology), issues #164 and #543,
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
   - the food log's create, find, photo, update, ordering and account scoping,
     plus the `food_entries` date, time and analysis-error checks;
   - the athlete-event replacement, `eventKey` dedupe, start-date ordering with
     both end dates, account scoping, transactional rollback and cascade;
   - the index set of the tables issue #300 touched, plus the
     `manual_activities` checks and the single-pending-question index;
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
- The migration, truncation and row-count helpers live in
  `apps/api/testDatabase` and are shared with the end-to-end suite, so both
  test databases are built the same way.
- The suite is split one file per store under `apps/api/integration/`: a
  migrations file plus `dbUserStore`, `dbPlanStore`, `dbPlanGenerationStore`,
  question stores, metrics stores, stored activity rows, manual activity writes,
  coach question constraints, the food entry store and athlete events.
  `integration/setup.ts` owns the shared hooks. Bun runs the files sequentially
  in one process, so it migrates once for the whole run and later files await
  that result instead of rebuilding the schema; it clears the administrator
  setting and every table before each test, and closes the pool after the last
  file. `integration/helpers.ts` owns the shared SQLSTATE and threshold readers.
  The migrations file stays on its own and still proves every migration applies
  from an empty database.
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
  PostgreSQL after `bun run db:up` and reports every suite in its own file.
- The suite fails if a migration does not apply, a constraint is dropped, a
  store stops writing its companion rows, run fencing stops rejecting a
  superseded save, a food entry leaks into another account or loses its order,
  or an event replacement appends instead of replacing.
- `bun run test` remains database-free and does not run the integration suite.
- CI runs the integration suite in its own job.
