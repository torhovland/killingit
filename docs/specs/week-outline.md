# Spec: Week plans are outlines, not seven finished workouts

- **Status:** Accepted (implemented)
- **Date:** 2026-11-01
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
   today and tomorrow, as an outline.
3. The combined full-plan prompt states the same rule.
4. A normalisation step drops a structured `bikeWorkout` from every session in
   the current and next week, so a model that ignores the prompt cannot leak a
   downloadable workout into a week outline.
5. Outline days still carry `estimatedTss` and the day's `estimatedFtpWatts`,
   and the week still carries its single `estimatedFtpWatts`, so training load
   and the fitness chart stay complete.
6. The app no longer copies the today or tomorrow day plan into the matching
   week session. Only the completion status is settled there.
7. A past or present week session keeps its planned outline when an activity is
   recorded; the activity settles the status instead of replacing the title,
   description, duration, or intensity.

### Out of scope

- A UI redesign. The Week tab already renders an outline as a title, duration,
  intensity, load, status, and a short description, and keeps showing only the
  week's single FTP estimate.
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
- A day that has arrived keeps this outline and may add one short sentence to
  the description saying how far it was completed. It never becomes a full
  activity summary.

The `today` and `tomorrow` day plans carry the existing full detail: a concrete
description, alternatives and optionality, a rationale, and a structured
`bikeWorkout` when the session is an indoor bike workout with power targets.

## Acceptance criteria

1. The weekly prompt explicitly asks for all seven days as short outlines.
2. The daily and plan-update prompts fully detail the day objects for today and,
   by default, tomorrow, and keep every week session as an outline.
3. The combined full-plan prompt contains the same rule and details the today
   and tomorrow day objects.
4. After a weekly, daily, or next-period generation, no session in the current or
   next week has a `bikeWorkout`; today's and tomorrow's day plans keep theirs.
5. Outline days keep `estimatedTss` and their daily `estimatedFtpWatts`, and the
   week keeps its single `estimatedFtpWatts`.
6. The today and tomorrow week sessions keep their outline title and
   description instead of mirroring the day plans; only the status is settled.
7. A completed or missed past day keeps its planned outline and records its
   `completed`, `partial`, `missed`, or `rest` status. Several activities on one
   day are judged together for that status.
8. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.

## Data-model / API impact

None. The week schema, route contracts, and stored JSON are unchanged. Outline
days simply use shorter values and leave `bikeWorkout` empty.

## Technical approach

- `WEEK_OUTLINE_RULES` in `apps/api/src/llm/promptRules.ts` states the rule once
  and is included in the weekly, daily, combined, and plan-update prompts. The
  prompt user messages make it concrete: the weekly prompt asks for all seven
  days as outlines, and the daily and update prompts name the day objects they
  fully detail.
- `outlineWeekPlans(plan)` in `apps/api/src/plans/outline.ts` clears
  `bikeWorkout` on every session in `week` and `nextWeek`. It runs on the final
  draft before training load and weather are attached, in both the full-build
  and plan-update paths.
- `applyCompletedDays` in `apps/api/src/plans/week.ts` groups every activity on
  a date, settles the session's status, and keeps the stored outline. A planned
  rest day used for training is the only day without a workout outline, so it
  shows a brief activity record instead.
- `applyTrainingLoad` resolves each day's `estimatedFtpWatts` from the coach's
  daily value, falling back to the week's estimate and then the stored
  timeline. An outline day without `bikeWorkout` still falls back to the coach's
  `estimatedTss` for TSS. The day plans keep their own `bikeWorkout`, with its
  FTP brought into step with the week's projection.

## Testing

- Prompt tests assert that the weekly prompt and the plan update contain the
  outline rule, that the weekly prompt asks for all seven days as outlines, and
  that the daily prompt names the day objects it details.
- Unit tests for `outlineWeekPlans` cover the current week, a next week, today's
  day plan, and estimated TSS on outline days.
- Unit tests for `applyCompletedDays` cover completed and missed past days,
  today's status, several activities on one date, manual activities, and a rest
  day used for training.
- Generation tests assert that the saved week keeps only outlines and that
  tomorrow's outline comes from the coach's week rather than its day plan.
- Run `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`.
