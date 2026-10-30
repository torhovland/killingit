# Spec: Week plans are outlines, not seven finished workouts

- **Status:** Accepted (implemented)
- **Date:** 2026-10-28
- **Related:** `docs/specs/coach-plan-prompts.md`,
  `docs/specs/coach-plan-lifecycle.md`, `docs/specs/training-load.md`.

## Goal

Keep the week and next-week plans at outline level. Every week session is a
short overview; the coach fully specifies only the `today` and `tomorrow` day
objects. The Week tab therefore shows the week's shape rather than repeating
the detailed workout the Day tab already shows, and the daily update turns an
outline into a concrete workout when the day arrives.

Planning every day in full detail up front wastes output tokens, invents
specific intervals days before the coach knows how the athlete has responded,
and makes later daily revisions rewrite detail that was never actionable. It
also duplicates the day plan in the week view.

## Scope

### In scope

1. The weekly update prompt (used for the current week, a new week, and the next
   week) asks for seven dated sessions that are all short outlines.
2. The daily update prompt and the plan-update prompt fully detail the `today`
   and `tomorrow` day objects and keep every session in the week, including
   today and tomorrow, as an outline. The next-period update names its target
   day as the last detailed day.
3. The combined full-plan prompt states the same rule.
4. A normalisation step drops a structured `bikeWorkout` from every session in
   the current and next week, so a model that ignores the prompt cannot leak a
   downloadable workout into a week outline.
5. Outline days still carry `estimatedTss` and the day's `estimatedFtpWatts`,
   and the week still carries its single `estimatedFtpWatts`, so training load
   and the fitness chart stay complete.
6. The app no longer copies the today or tomorrow day plan into the matching
   week session. Only the completion status is settled there.
7. Block-week and season-block summaries keep their planned focus and target
   load, with at most one short sentence on completion.

### Out of scope

- A UI redesign. The Week tab already renders an outline as a title, duration,
  intensity, load, and a short description, and keeps showing only the week's
  single FTP estimate.
- Showing the daily FTP projection on each day in the Week view. The Fitness
  page charts the daily series instead; see `docs/specs/fitness-page.md`.

## What "outline" means

For every session in the current and next week, including today and tomorrow:

- `type` is `workout` or `rest`.
- `title` names the kind of session (for example "Long ride" or "Easy run").
- `description` is one sentence about the session's intent.
- `durationMinutes` and `intensity` are approximate.
- `estimatedTss` is complete.
- `estimatedFtpWatts` is the coach's projection for that day.
- `bikeWorkout` is null; no intervals, repetitions, paces, or power targets are
  prescribed.
- A day that has arrived may add one short sentence to the description saying
  how far it was completed, but not a full activity summary.

The `today` and `tomorrow` day plans carry the existing full detail: a concrete
description, alternatives and optionality, a rationale, and a structured
`bikeWorkout` when the session is an indoor bike workout with power targets.

Past days keep describing what actually happened, as before.

## Acceptance criteria

1. The weekly prompt explicitly asks for all seven days as short outlines.
2. The daily and plan-update prompts fully detail the day objects for today and,
   by default, tomorrow, keep every week session as an outline, and name the
   last detailed day. A next-period update details tomorrow and keeps the
   current week unchanged.
3. The combined full-plan prompt contains the same rule and details the today
   and tomorrow day objects.
4. After a weekly, daily, or next-period generation, no session in the current or
   next week has a `bikeWorkout`; today's and tomorrow's day plans keep theirs.
5. Outline days keep `estimatedTss` and their daily `estimatedFtpWatts`, and the
   week keeps its single `estimatedFtpWatts`.
6. The today and tomorrow week sessions keep their outline title and
   description instead of mirroring the day plans; only the status is settled.
7. Block weeks and season blocks keep their planned focus, with at most one
   completion sentence.
8. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.

## Data-model / API impact

None. The week schema, route contracts, and stored JSON are unchanged. Outline
days simply use shorter values and leave `bikeWorkout` empty.

## Technical approach

- `WEEK_OUTLINE_RULES` in `apps/api/src/llm/promptRules.ts` states the rule once
  and is included in the weekly, daily, combined, and plan-update prompts. The
  prompt user messages make it concrete: the weekly prompt asks for all seven
  days as outlines, and the update prompts name the day objects they detail.
- `outlineWeekPlans(plan)` in `apps/api/src/plans/outline.ts` clears
  `bikeWorkout` on every session in `week` and `nextWeek`. It runs on the final
  draft before training load and weather are attached, in both the full-build
  and plan-update paths.
- `applyCompletedDays` keeps the week's outline for today and settles only its
  status. The day plan is no longer mirrored into the week.
- A tomorrow-only update takes the matching outline from the coach's returned
  week and leaves the other sessions untouched, so the Week view follows the
  revised day without copying its detailed prescription.
- `PERIOD_SUMMARY_RULES` in `apps/api/src/llm/promptRules.ts` tells the coach to
  keep block-week and season-block focuses planned, adding at most one
  completion sentence.
- `applyTrainingLoad` resolves each day's `estimatedFtpWatts` from the coach's
  daily value, falling back to the week's estimate and then the stored
  timeline. An outline day without `bikeWorkout` still falls back to the coach's
  `estimatedTss` for TSS.

## Testing

- Prompt tests assert that the weekly prompt and the plan update contain the
  outline rule, that the weekly prompt asks for all seven days as outlines, and
  that the daily prompt names the day objects it details.
- Unit tests for `outlineWeekPlans` cover the current week, a next week, today's
  day plan, and a later day that had a `bikeWorkout`.
- A generation test with a fake provider that returns a bike workout for every
  day asserts that the saved week has none and the today day plan keeps its own.
- Unit tests for `applyCompletedDays` assert that today's week outline is kept
  and only the status is settled.
- Run `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`.
