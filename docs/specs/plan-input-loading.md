# Plan-run input loading

## Goal

A plan run reads a dozen inputs before it builds a prompt. Make every one of
them injectable and decide, in one place, which inputs a run cannot do without
and which it can plan around when their read fails.

## Background

`apps/api/src/plans/trigger.ts` hard-wired `loadPlanDayCalories`,
`latestActivityAnalysisSince`, `captureCompletedPeriodReviews`,
`recordPlanFtpEstimates`, `saveCoachQuestions` (and the two sibling writers
`recordCoachBodyMetrics` and `clearPendingCoachQuestions`) while the other
loaders came from `PlanTriggerDependencies`. Fail-open handling was also
uneven: events, calorie targets, daily health and the forecast were wrapped in
`try`/`catch`, while the diet log, thresholds and body history were not, so a
transient metrics or diet read failed an otherwise possible plan.

## Scope

### In scope

1. Every plan-run loader and writer is a `PlanTriggerDependencies` field, with
   a production default applied where it is used. `AppDependencies` forwards
   them through `planTriggerDependencies`, so a test can inject any of them
   through `createApp` or by constructing `PlanTriggerDependencies` directly.
2. One function, `loadPlanInputs` in `trigger.ts`, reads every advisory prompt
   input and owns the fail-open policy for all of them.
3. One function, `loadPlanGenerationContext` in `generationContext.ts`, prepares
   a run: it reads the model credentials, runs the Garmin sync and reads the
   remaining required inputs, and it owns the run's fenced failure handling.
4. A read that fails is logged with its label and the run continues without
   that input.

### Out of scope

- The stored plan, the prompt text, the database schema and the API contract.
- The reply-context loader (`coaching/replyContext.ts`), which already applies
  the same per-input policy for coach replies.
- The Garmin sync and the activity-analysis sharing itself; only the loader that
  waits for a newer pass becomes injectable.

## Policy

Required inputs fail the run; advisory inputs never do.

| Input                                                         | Policy   |
| ------------------------------------------------------------- | -------- |
| LLM credentials (read first)                                  | required |
| analysed activity feed                                        | required |
| stored plan, answers, coaching inputs, account, coach answers | required |
| survey adjustments                                            | required |
| athlete events                                                | advisory |
| diet log                                                      | advisory |
| earlier daily calorie targets                                 | advisory |
| threshold history (summaries and timelines)                   | advisory |
| body weight and body-fat history                              | advisory |
| daily health series                                           | advisory |
| weather forecast (only read when the athlete has a location)  | advisory |

A required read failure still fails the generation row, because a plan built for
another account or without the stored plan would be wrong rather than merely
thinner. An advisory failure leaves the prompt without that section, which is
the same trade-off the reply context already makes.

The stored writers — the period-review capture, the FTP and body-metric time
series, the coach question and its clearing — are injectable too, but their own
failure semantics stay with `generate.ts`, where storing a generated plan is
fail-open.

## Order of reads

`loadPlanGenerationContext` prepares a run in three stages:

1. the account's model credentials, a fast database read;
2. the Garmin sync and the analysed feed;
3. the stored plan, answers, coaching inputs, account, answered coach questions
   and survey adjustments, in parallel.

The credentials come first on purpose. An account without a key is told
"OpenRouter is not configured. Add a key and model first." and its generation
row fails before a slow sync runs, so a missing key costs a database read
instead of a Garmin round trip. The row already reads "Preparing your plan" when
the run begins, so this check needs no progress step of its own; the sync and
preparation steps follow as before. A caller that already holds the analysed
feed (`routes/coaching/feed.ts`) skips the sync but still checks the key first.

The preparation is fenced like the rest of the run: an aborted run throws
`GenerationSupersededError` without writing, and any other failure marks the
generation failed and rethrows.

The prompt windows that `loadPlanInputs` reads are named constants
(`CALORIE_HISTORY_DAYS` for the earlier calorie targets and
`DAILY_HEALTH_HISTORY_DAYS` for the daily health series) rather than bare
numbers at the call site.

## Acceptance criteria

- `trigger.ts` and `generationContext.ts` contain no direct call to a production
  loader or writer except as the `??` default of a dependency field.
- A failing advisory loader is logged and the run reaches the model; a failing
  required loader fails the generation.
- A run whose account has no model fails with the configuration message and
  never reaches the Garmin sync.
- `trigger.test.ts` runs a whole plan run with every loader and writer in
  memory, so it never needs a database.
- `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test` and
  `bun run check:unused` pass.
