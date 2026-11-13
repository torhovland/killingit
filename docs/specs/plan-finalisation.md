# Spec: One plan finalisation pipeline

- **Status:** Accepted (implemented)
- **Date:** 2026-11-13
- **Related:** `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/week-outline.md`, `docs/specs/location-and-weather.md`,
  `docs/specs/diet-progress-targets.md`, `docs/specs/training-load.md`,
  `docs/specs/season-block-boundaries.md`, `docs/specs/activity-local-date.md`.

## Goal

Post-process a plan in exactly one place, in one fixed order, so that a fresh
build, an incremental update and a stored-plan re-save can never save
structurally different plans for the same input.

## Background

`apps/api/src/plans/generate.ts` settled and post-processed a plan in three
places:

| Path                                        | Steps, in the order they ran                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| fresh build (`generateFreshPlan`)           | today's status, completed days, **diet progress sync**, outline, drop unplaced tomorrow, forecast, training load, validate |
| update (`advancePlan`)                      | today's status, completed days, outline, drop unplaced tomorrow, forecast, training load, **diet progress sync**, validate |
| stored-plan re-save (`reconcileStoredPlan`) | today's status, completed days, drop unplaced tomorrow, training load                                                      |

The copies drifted: the diet progress sync ran before outlining in one path and
after the training load in another, and the re-save skipped the outline, the
forecast, the diet sync and the validation entirely. Some of those differences
are deliberate (the re-save keeps the stored training content), and some were
accidental. Every difference is a way for two visits with the same input to
produce different stored plans.

## Scope

### In scope

1. One `finalizePlan(plan, input, steps)` in
   `apps/api/src/plans/finalize.ts`, used by all three paths.
2. `FINALIZE_PLAN_STEPS` declares the pipeline's step names in the order they
   run, and `finalizePlan` iterates that list, so the exported order is the
   executed order.
3. Two step sets, `COACH_PLAN_FINALISATION` (every step) and
   `STORED_PLAN_FINALISATION` (the re-save), so a path states what it skips and
   why rather than repeating a pipeline.
4. Tests that pin the declared order, the two orders that change the saved plan,
   and the behaviour of every step the re-save skips.

### Out of scope

- The prompt, the schema, the database and the stored plan shape. No data-model
  or API change.
- Making the re-save run the steps it deliberately skips. See "Step sets".

## The pipeline

Steps run in this order, and each one may be switched on or off by the step set
its caller passes:

| Step                   | What it does                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `settleToday`          | Derives today's status from what was actually recorded (`deriveTodayStatus`), keeping the coach's `partial` verdict.            |
| `settleCompletedDays`  | Applies the recorded activities to the week's past and present sessions (`applyCompletedDays`), using the status settled above. |
| `outlineWeeks`         | Strips structured workouts from the week outlines (`outlineWeekPlans`).                                                         |
| `dropUnplacedTomorrow` | Drops a `tomorrow` that falls outside both the stored weeks and blocks.                                                         |
| `attachForecast`       | Attaches the forecast to every session (`applyForecastToPlan`).                                                                 |
| `syncDietProgress`     | Copies the diet progress targets from the detailed block and week to the matching summaries (`syncDietProgressTargets`).        |
| `applyTrainingLoad`    | Recalculates each session's TSS and the day-by-day ATL, CTL and TSB.                                                            |
| `validatePlan`         | Rejects a plan that cannot be shown (`assertPlanValid`, including the season-block boundaries).                                 |

The order is not arbitrary:

- **Today before the week.** The week's session for today takes its verdict from
  the settled day plan, so settling the day first keeps the Day and Week tabs
  agreeing on today's completion.
- **Outline before the load.** The training load scores a session from its
  structured indoor workout when it carries one, so the outline contract must
  strip those workouts from the week before the week is scored; otherwise the
  week's TSS would come from a workout the outline no longer carries.
- **Drop before the forecast.** A session that is dropped is not part of the
  saved plan, so it is never given weather.
- **Load before the diet copy.** The copy reads the block and week objects that
  are about to be saved, so it runs after every step that rebuilds them.
- **Validate last.** Validation describes the plan that is about to be stored.

## One today-status rule

Today's completion is decided once. `todayCompletionStatus` in
`apps/api/src/plans/week.ts` receives the planned session, the activities
recorded on the day and the coach's verdict; `deriveTodayStatus` (the
`settleToday` step) and the week's today session both call it, so the Day and
Week tabs cannot disagree. `activitiesOnDate` in the same module is the only
place that turns a manual entry into a recorded activity (`type: "manual"`, no
measured duration) and that reads a synced activity's local day, so both levels
also agree on which activities happened on a date. A recorded activity is
required: a stored `completed` verdict on a day with no activity settles back to
`planned` (or `rest`).

## Step sets

`COACH_PLAN_FINALISATION` runs every step. The fresh build and every plan
update use it: both just received a plan from the coach, so the outline, the
forecast, the diet targets and the validation all apply.

`STORED_PLAN_FINALISATION` runs the re-save in `finishUnchangedPlan`, which
stores a stored plan again without a coach completion. It keeps the stored
training content, so it turns off four steps:

- `outlineWeeks: false` — the plan was outlined when it was written. Outlining
  again would rewrite a stored session rather than keep it (a stored plan whose
  week still carries a workout loses it), and the re-save's contract is to keep
  the training content.
- `attachForecast: false` — the stored sessions keep the forecast they were
  planned with. Re-attaching today's forecast would change a stored plan without
  a coach deciding anything about it, which is a plan revision, not a re-save.
- `syncDietProgress: false` — no coach returned a new target, so there is
  nothing to copy.
- `validatePlan: false` — the plan was validated when it was written. A stored
  plan that has since become undisplayable must not turn a run with no coach
  completion into a failed generation.

The steps that read recorded data — today's status, the completed days and the
training load — still run, because they are exactly what the re-save exists to
refresh.

## The fresh build's two completions

A fresh build settles the plan before it asks the coach for anything else: the
settlement steps run on the draft, the next-period completion and the
progress-only diet completion see the settled plan, and the plan that is saved
runs the whole pipeline. Every other plan prompt already sees the recorded
completion, so the next-period completion now does too; the saved plan for the
same input is unchanged.

## Data model and API impact

None. `finalizePlan` is an internal function; the stored plan keeps its shape and
the generation status, routes and prompts are unchanged.

## Acceptance criteria

1. The fresh build, the update and the stored-plan re-save all post-process
   through `finalizePlan`; no path repeats the steps on its own.
2. The pipeline's declared step order is the order the steps run in.
3. Outlining runs before the training load, so an indoor workout that the
   outline strips does not set the week's TSS.
4. Today's status is settled before the week's completed days, so today's week
   session and today's day plan carry the same status.
5. The re-save keeps the stored training content: the week keeps a stored
   structured workout, the sessions keep their stored weather, the diet summaries
   are not re-synced, and an invalid stored plan is saved without failing the run.
6. Every generation path's saved plan is unchanged by this refactor.
7. One rule decides today's status for both the day plan and the week's today
   session, and one function adapts a manual entry to a recorded activity.
8. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test` and
   `bun run check:unused` pass.
