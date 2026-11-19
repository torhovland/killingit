# Spec: Plan run resilience to a lost database connection

- **Status:** Accepted (implemented)
- **Date:** 2026-11-19
- **Related:** `apps/api/src/plans/trigger.ts`, `apps/api/src/plans/runs.ts`,
  `apps/api/src/plans/generation.ts`, `apps/api/src/routes/plan.ts`,
  `apps/api/src/coaching/coachRun.ts`,
  `apps/api/src/instrumentation/reportError.ts`,
  `docs/specs/database-connection.md`, `docs/specs/coach-run-cancellation.md`,
  ADR 0038.

## Goal

A background coach run whose database writes have started failing must stop
instead of refreshing a lease it can no longer write, and every failure that
ends a background run must reach Sentry. On 2026-11-19 a Neon authentication
timeout poisoned the API's pool: the heartbeat failed every 15 seconds for five
minutes, the run could not record its own failure, the generation row stayed
`running` for 39 minutes, and nothing reached Sentry because every failure path
only wrote to `console.error`.

## Scope

### In scope

1. `startHeartbeat` counts consecutive failed heartbeats. A success resets the
   count; `HEARTBEAT_FAILURE_LIMIT` consecutive failures clear the interval,
   stop the run through the run registry, attempt one failure write, and report
   the error. Below the limit it only logs.
2. `apps/api/src/instrumentation/reportError.ts` exports `reportError`, which
   sends an error to Sentry when this process has a client bound and does
   nothing otherwise. It is the default for a new injectable `reportError`
   dependency on `AppDependencies` and `PlanTriggerDependencies`.
3. The paths that end a background run report through it:
   `startBackgroundPlan`'s catch, the heartbeat escalation, `startCoachRun`'s
   catch, and the plan read that releases a stale generation row.
4. `plans/runs.ts` gains `stopRun(userId, runId, reason)`, which aborts the
   run's signal only while that run still owns the user's slot.

### Out of scope

- The pool's timeouts and one-shot query retry, which are
  `docs/specs/database-connection.md`.
- A hard maximum duration for a run that keeps heartbeating successfully.
- Sentry alerts, dashboards or an issue per failure class.
- Retrying a plan run, or resuming one from its last step.

## Rules

- The failure count is per heartbeat, in the interval's closure; it is not
  module state, so two runs cannot share a count.
- Stopping is idempotent: `stopRun` ignores a run id that no longer owns the
  user's slot, and a stopped run releases its slot like a settled one.
- The athlete-facing reason comes from `planFailureMessage` (ADR 0038); the raw
  error goes to the log and to Sentry.
- The stale-release report names the run id and the last heartbeat time, and
  never includes the connection string.
- Reporting never replaces the existing log line, and a report is sent once per
  stopped run, not once per failed heartbeat.
- `reportError` drops the event when `Sentry.getClient()` is undefined, which is
  the case in unit tests and local development without a DSN.

## Data-model and API impact

None. No schema, migration, route or response change. The plan read keeps
returning the same `generation` block; only its side effects change.

## Acceptance criteria

1. Three consecutive heartbeat failures stop the run, report the error once and
   call the generation store's `fail` once with the athlete-facing reason.
2. A successful heartbeat between failures resets the count, so a flaky
   connection does not stop a run.
3. A heartbeat failure below the limit logs and leaves the run running.
4. The plan read that releases a stale run reports the released run id; the read
   that loses the release to a newer run reports nothing.
5. A background plan failure and a coach-run failure each report the raw error.
6. Unit tests cover 1–5, and typecheck, lint, format, the unused-export check and
   the unit suite pass.
