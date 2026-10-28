# Spec: Week plans are outlines, not seven finished workouts

- **Status:** Accepted (implemented)
- **Date:** 2026-10-28
- **Related:** `docs/specs/coach-plan-prompts.md`,
  `docs/specs/coach-plan-lifecycle.md`, `docs/specs/training-load.md`.

## Goal

Keep the week and next-week plans at outline level. The coach fully specifies
only today's session and, when it is in the week, tomorrow's. Later days state
the session type, a brief focus, an approximate duration and intensity, the
estimated TSS, and the week's estimated FTP, and are turned into concrete
workouts by the daily update when the day arrives.

Planning every future day in full detail up front wastes output tokens, invents
specific intervals days before the coach knows how the athlete has responded,
and makes later daily revisions rewrite detail that was never actionable.

## Scope

### In scope

1. The weekly update prompt (used for the current week, a new week, and the next
   week) asks for seven dated sessions that are all short outlines.
2. The daily update prompt fully details today and, by default, tomorrow, and
   keeps every later day as an outline while revising the outlines around what
   happened. The next-period update names its target day as the last detailed
   day, so the day after tomorrow stays an outline.
3. The combined full-plan prompt states the same rule.
4. A normalisation step drops a structured `bikeWorkout` from every day after
   tomorrow, so a model that ignores the prompt cannot leak a downloadable
   workout into an outline day.
5. Outline days still carry `estimatedTss` and the day's `estimatedFtpWatts`,
   and the week still carries its single `estimatedFtpWatts`, so training load
   and the fitness chart stay complete.

### Out of scope

- A UI redesign. The Week tab already renders an outline as a title, duration,
  intensity, load, and a short description, and keeps showing only the week's
  single FTP estimate.
- Showing the daily FTP projection on each day in the Week view. The Fitness
  page charts the daily series instead; see `docs/specs/fitness-page.md`.

## What "outline" means

For a day after tomorrow:

- `type` is `workout` or `rest`.
- `title` names the kind of session (for example "Long ride" or "Easy run").
- `description` is one sentence about the session's intent.
- `durationMinutes` and `intensity` are approximate.
- `estimatedTss` is complete.
- `estimatedFtpWatts` is the coach's projection for that day.
- `bikeWorkout` is null; no intervals, repetitions, paces, or power targets are
  prescribed.

For today and tomorrow:

- The existing full-detail rules apply: a concrete description, alternatives
  and optionality on the day plans, and a structured `bikeWorkout` when the
  session is an indoor bike workout with power targets.

Past days keep describing what actually happened, as before.

## Acceptance criteria

1. The weekly prompt explicitly asks for all seven days as short outlines.
2. The daily prompt fully details today and, by default, tomorrow, keeps later
   days as outlines, and names the last detailed date. The next-period update
   names only its target day.
3. The combined full-plan prompt contains the same rule and details today and
   tomorrow.
4. After a weekly, daily, or next-period generation, no week session dated after
   tomorrow has a `bikeWorkout`; today's and tomorrow's sessions keep theirs.
5. Outline days keep `estimatedTss` and their daily `estimatedFtpWatts`, and
   the week keeps its single `estimatedFtpWatts`.
6. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.

## Data-model / API impact

None. The week schema, route contracts, and stored JSON are unchanged. Outline
days simply use shorter values and leave `bikeWorkout` empty.

## Technical approach

- `WEEK_OUTLINE_RULES` in `apps/api/src/llm/planContext.ts` states the rule once
  and is included in the weekly, daily, and combined prompts. The prompt user
  messages make it concrete: the weekly prompt asks for all seven days as
  outlines, and the daily prompt names the last detailed date.
- `generateTargetDayUpdate` passes `detailThrough: input.today` (the target day,
  which is tomorrow in the caller), so only that day is detailed in the next
  week.
- `outlineFutureSessions(plan, today)` in `apps/api/src/plans/outline.ts` clears
  `bikeWorkout` on every session in `week` and `nextWeek` dated after tomorrow.
  It runs on the final draft before training load and weather are attached, in
  both the full-build and cascade paths.
- `applyTrainingLoad` resolves each day's `estimatedFtpWatts` from the coach's
  daily value, falling back to the week's estimate and then the stored
  timeline. An outline day without `bikeWorkout` still falls back to the coach's
  `estimatedTss` for TSS.

## Testing

- Prompt tests assert that the weekly and daily prompts contain the outline rule,
  that the weekly prompt asks for all seven days as outlines, and that the daily
  prompt names the last detailed date.
- Unit tests for `outlineFutureSessions` cover the current week, a next week,
  today, tomorrow, and a later day that had a `bikeWorkout`.
- A generation test with a fake provider that returns a bike workout for every
  day asserts that the saved plan keeps only today's and tomorrow's.
- Run `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`.
