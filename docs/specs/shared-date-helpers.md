# Shared date helpers

## Goal

Plan dates are `YYYY-MM-DD` strings with UTC arithmetic. The same helpers
(`addDays`, `startOfWeek`, `weekDates`) are currently copied into the API, the
web app, the shared package, and test fixtures. A fix to one copy does not reach
the others. Keep a single implementation in `packages/shared` and import it
everywhere.

## Scope

- `packages/shared/src/date.ts` owns `addDays`, `startOfWeek` and `weekDates`
  next to `planDateSchema`, and `packages/shared/src/index.ts` re-exports them.
- `packages/shared/src/trainingLoad.ts` and
  `packages/shared/src/metrics.ts` import `addDays` from `./date.js` instead of
  keeping a local copy.
- `apps/api/src/plans/dates.ts` keeps only its API-specific helpers
  (`isAfterPlanTomorrowCutoff`, `localDateTimeInZone`); every API module imports
  the generic helpers from `@killingit/shared`.
- `apps/web/src/calendarDates.ts` keeps the month-grid helpers, imports
  `addDays`/`startOfWeek` from `@killingit/shared`, and lets `buildMonthGrid`
  reuse `startOfWeek` instead of repeating the weekday arithmetic.
- `apps/web/src/costChart.ts` and `apps/api/integration/planFixture.ts` import
  `addDays` from `@killingit/shared` instead of defining their own.
- `weekEnd(week)` stays in `apps/api/src/plans/periods.ts`: it takes a stored
  `WeekPlan`, so it is a plan helper rather than a date primitive, and it is
  built on the shared `addDays`.

## Acceptance criteria

- Exactly one `addDays` implementation exists in the repository.
- Exactly one `startOfWeek` implementation exists, and `weekDates` builds on
  it.
- `packages/shared/src/date.test.ts` covers the moved helpers, including month,
  year and leap-day boundaries.
- `bun run typecheck`, `bun run lint`, `bun run format` and `bun run test` pass.

## Data model and API impact

None. The helpers keep their names, signatures and behaviour, so no schema,
route or prompt changes.
