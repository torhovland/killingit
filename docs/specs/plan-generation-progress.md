# Spec: Time-estimated plan generation progress

- **Status:** Accepted (implemented)
- **Date:** 2026-10-25
- **Related:** `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/openrouter-llm-integration.md`, ADR 0004 (OpenRouter).

## Goal

Make the plan progress bar move continuously while the coach is generating,
instead of sitting on a checkpoint (currently 45%, 70%, 90%) for the whole
duration of an LLM call.

## Problem

`runPlanGeneration` writes progress only immediately before each LLM call, with
a hard-coded percentage. Each call then runs for tens of seconds with no status
change, so the UI shows the same number until the next call starts. The real
progress inside a call is unknown; the server can neither stream it nor compute
it from tokens in a way that maps to plan phases.

## Approach

Give every step a **target percentage** and interpolate the reported percentage
between the value reached when the step started and that target, based on elapsed
time and the step's expected duration. Expected durations are learned from
previous runs.

The interpolation happens in the API when a status row is read, so the response
schema does not change: the UI already renders `generation.progress` on every
poll. Only the bar's CSS transition changes.

### Steps

A step is `{ id, label, target, defaultMs }`:

- `id` is a stable key used to learn how long that kind of step takes. The
  initial build and the single plan-update completion have separate ids, so the
  update bar keeps its own learned duration.
- `label` is the existing UI copy.
- `target` is the percentage the bar approaches while the step runs. Targets
  increase along every possible path, so progress never moves backwards.
- `defaultMs` is the expected duration before the step has ever run.

The step table lives in `apps/api/src/plans/steps.ts`.

### Estimation

`progressAt(from, target, elapsedMs, expectedMs)` returns

```
floor + (target - floor) * clamp(elapsedMs / expectedMs, 0, 1)
```

rounded to an integer. The result is capped at the step target, so a slow step
stops at the target rather than overshooting the next step. `expectedMs` of zero
means the step is considered complete immediately.

When a step starts, the floor is the interpolated value of the step that just
finished, not a fixed constant. This removes the jumps between checkpoints. If a
run skips early steps, the bar sweeps from its current value to the target of the
first step it does run instead of jumping.

### Learning step durations

`plan_generation_step_durations` stores one row per step id with an exponentially
weighted moving average of observed durations (`average_ms`) and a sample count.
The first sample is used as-is; later samples update the average with a 0.3
weight. Durations are measured from the previous step's `step_started_at` to the
moment the next step starts.

The average is global, not per user or per model. It adapts after a model change,
at the cost of a few runs. A step with no sample uses `defaultMs`.

### Persistence

`plan_generations` gains:

- `step_id` — stable step key, null outside a run.
- `progress_end` — target for the current step, default 100.
- `step_started_at` — when the current step began; separate from `updated_at`
  because heartbeats refresh that column.
- `step_expected_ms` — the expected duration used for this step, default 0.

`begin` starts the prepare step at 5%. Each `update` records the finished
step's duration, carries the current estimate forward as the new floor, and
starts the new step. `finish` records the last step and reports 100%. `fail`
settles at the current estimate so the bar does not jump backwards on error.
Heartbeats keep refreshing `updated_at` only.

## Scope

### In scope

1. Step definitions and pure estimation helpers.
2. New columns and duration table with a migration.
3. Store changes: interpolate on read, learn durations on step changes.
4. Step call sites in `generate.ts` use the definitions.
5. Unit tests for interpolation and duration averaging.
6. The web bar's width transition matches the 1.5s poll interval so consecutive
   polls look continuous.

### Out of scope

- Streaming LLM responses to derive progress from tokens.
- Per-user or per-model duration averages.
- Changing the poll interval or the status response schema.

## Acceptance criteria

1. Two polls within the same step return increasing percentages that stay
   between the step's floor and its target.
2. Moving to a new step never lowers the reported percentage.
3. A slow step stops at its target; it never reports more than its target while
   running.
4. Interpolation uses the last learned average; a missing row falls back to the
   step's default.
5. `done` reports 100 and `error` reports the value reached when it failed.
6. Typecheck, lint, format, and tests pass.

## Tests

- Unit tests for `progressAt` (start, halfway, past the expected duration,
  target at or below the from value, zero expected duration).
- Unit tests for the duration average (first sample, weighted update, bounds).
- Existing generation and route tests updated for the new `update` signature.

## Risks

- **Wrong estimate:** defaults are guesses until a step has run once. When the
  estimate is short the bar reaches the target and waits; when it is long the bar
  moves slowly but keeps moving. Learning corrects both.
- **Shared average:** users on very different models share one average. It is a
  display heuristic only.
- **Extra writes:** each step change adds one read and one upsert. There are at
  most a handful of steps per generation.
