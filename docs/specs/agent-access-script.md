# Spec: Agent access script

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Issue:** #345
- **Related:** `scripts/agent.sh`, `scripts/agent.test.ts`, `README.md`,
  `AGENTS.md`, `.github/workflows/deploy.yml`.

## Goal

`scripts/agent.sh` is how the coding agent reads Cloud Run logs and queries the
Neon database. It has to answer with its own usage message when it is called
wrong, and its defaults must never write to a database by accident.

## Scope

### In scope

1. Parse `--env`, `--tail`, `--write` and the positionals in one pass. Two
   earlier loops are deleted: the one that parsed nothing and the unused
   `prev` assignment.
2. Answer a missing or unknown command, a missing query, a missing `--env`
   value, an invalid `--env`, a missing service, an unknown service, a missing
   database variable and a non-numeric `--tail` with the same usage text, and
   exit non-zero. No path may abort with Bash's `unbound variable` message.
3. Read the service argument: `logs api` reads the API service, `logs garmin`
   reads the Garmin sidecar (`killingit-garmin` / `killingit-garmin-test`, the
   names `.github/workflows/deploy.yml` creates).
4. Default to the `test` environment. `sql` selects exactly one connection
   variable: `DATABASE_URL_TEST` for `test`, `DATABASE_URL_PROD` for `prod`.
   Neither is used as a fallback for the other.
5. Run `sql` in a read-only session (`PGOPTIONS=-c
default_transaction_read_only=on`) unless `--write` asks for a read-write
   session. The log line names the session.
6. A test that spawns the script with stub `gcloud` and `psql` programs and
   asserts the calls it makes.
7. Update the README and `AGENTS.md` and add this spec.

### Out of scope

- Keyword screening of a query. The read-only session is the guarantee; a
  keyword list would misfire on comments, strings and a query that merely
  mentions a write keyword, so it is not used.
- Changes to the deploy workflow, Cloud Run services, Neon branches or the
  application.
- A `shellcheck` dependency.

## Behaviour

### Commands

```text
scripts/agent.sh logs <api|garmin> [--env test|prod] [--tail N]
scripts/agent.sh sql "<query>" [--env test|prod] [--write]
```

The environment defaults to `test`; `--tail` defaults to `100`. `--tail` must
be a non-negative integer. `--write` is only valid for `sql`; an extra
positional is refused.

### Safety

- A `sql` run without `--env` targets the test database, so a forgotten flag
  cannot reach production.
- Without `--write` the session is read-only at the server, which refuses an
  `INSERT`, `UPDATE`, `DELETE` or DDL statement regardless of how it is
  written. `--write` is the maintainer's explicit opt-in, and it does not
  change which database `--env` selected.
- `DATABASE_URL_TEST` and `DATABASE_URL_PROD` are read independently. A missing
  variable is reported by name with usage; there is no fallback to
  `DATABASE_URL` or to the other environment.

## Acceptance criteria

1. `sql "SELECT 1" --env test` calls `psql` with `DATABASE_URL_TEST`, never
   `DATABASE_URL_PROD`, and without `--env` does the same.
2. The read-only `PGOPTIONS` is set by default and is absent under `--write`.
3. A missing database variable, a missing or unknown command, a missing query,
   a missing `--env` value, `--env staging`, a missing or unknown service and a
   non-numeric `--tail` print the usage text and exit non-zero, with no
   "unbound variable" text.
4. `logs garmin` reads `killingit-garmin-test` under the default environment
   and `killingit-garmin` under `--env prod`; `logs api` reads the API service.
5. `scripts/agent.test.ts` covers the above under `bun run test`.
6. `bun run typecheck`, `bun run lint` and `bun run format` pass.

## Data model and API impact

None. No application code, schema, route, migration or runtime dependency
changes; only a development script, its test and the documentation.
