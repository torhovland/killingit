# Spec: FTP estimate, TSS, and training load

- **Status:** Accepted (implemented)
- **Date:** 2026-10-27
- **Related:** ADR 0012, `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/bike-workout-export.md`, `docs/specs/garmin-activity-integration.md`.

## Goal

Show the athlete how hard each planned or completed day is, how their fitness
and fatigue are trending, and what FTP the coach expects for the week. The
numbers must agree across the Day, Week, and Block tabs.

## Scope

### In scope

1. Read the first FTP the athlete states in their survey answers.
2. Ask the coach for a week-by-week FTP estimate and for a TSS estimate on
   every session. The estimate is anchored to the stated FTP and shown in the
   Week and Block tabs.
3. Calculate TSS from recorded power when an activity has it, using the week's
   estimated FTP. Score structured indoor bike workouts from their intervals.
   Use the coach's estimate for every other session.
4. Calculate ATL, CTL, and TSB for each day from the resolved TSS values, and
   show all four numbers in the Today, Tomorrow, and Week views.

### Out of scope (deferred)

- A user-editable FTP setting. The athlete states FTP in the profile for now.
- Persisting a multi-season training-load history. ATL/CTL are seeded from the
  recent activity feed (42 days) on each generation.
- A dedicated load chart. This change adds the numbers, not a graph.
- Sport-specific threshold models (running pace, swim CSS, rowing).

## Behaviour

### FTP

- `extractFtpWatts` reads the first plausible FTP (50–2000 W) from the athlete's
  answers. It accepts `FTP: 250`, `FTP around 220 W`, `280 W FTP`, and similar.
  The first value is the current baseline; a later "when fit" number is not
  used as the current FTP.
- A revised FTP is picked up from any dated athlete input: an activity comment,
  a manual activity, the weekly note, or a week/block review comment. The
  newest mention wins. If the survey answers were saved after that mention, the
  profile is treated as the newer source. A revised test result also floors the
  current and next week's estimate, so an older weekly projection cannot show a
  lower current FTP than the test.
- With a stated FTP, the coach returns `estimatedFtpWatts` for the week and for
  every week of the block. The API clamps each estimate to 70–150% of the
  stated value so a model error cannot produce an absurd number. A missing
  estimate falls back to the stated FTP.
- With no stated FTP, every `estimatedFtpWatts` is stored as `null`, and the
  UI hides it. The coach is told not to invent one.

### TSS

For each session in the stored week (and next week), the resolved TSS is:

1. **Measured power.** If the date has a recorded activity with normalized
   power and the week has an estimated FTP, score
   `hours × (NP / FTP)² × 100`. Multiple activities on a day are summed.
2. **Structured indoor workout.** If the session has a `bikeWorkout`, score
   every interval from its percentage of FTP. The absolute FTP cancels out, so
   this works even without a stated FTP.
3. **Coach estimate.** Use the session's `estimatedTss` returned by the coach.
4. **Fallback.** If the coach omitted the number, score the session from its
   duration and intensity (40, 60, or 80 TSS per hour for easy, moderate, or
   hard). This keeps every workout with a number.

Rest days score 0.

Normalized power is computed from the recorded samples when the activity feed is
summarized: power is expanded onto a one-second timeline, averaged over a
30-second rolling window, and combined as a fourth-power mean. The activity
summary stores average and normalized power, so the plan generator never needs
the raw timeseries.

### ATL, CTL, and TSB

For every day in the week:

- `ATL = ATL_prev + (TSS − ATL_prev) / 7`
- `CTL = CTL_prev + (TSS − CTL_prev) / 42`
- `TSB = CTL − ATL`

The series starts 42 days before the week. Garmin now syncs the last 42 days,
matching this window. Plan generation analyses the largest feed the activity
cap allows (20 activities); the load seeding uses whatever activity history is
available. Recorded activities are scored with measured power where possible;
the rest use a duration-based estimate purely for seeding (they are never shown
as a workout's TSS). A day without activity or a planned session counts as
rest.

The resolved `trainingLoad` is copied from the week session into the matching
`today`/`tomorrow` day plan, so the Day and Week tabs cannot disagree.

## Data model / API impact

Shared (`@killingit/shared`):

- `trainingLoadSchema`: `{ tss, atl, ctl, tsb }` on week sessions and day plans.
- `estimatedTss` (optional, non-negative) on week sessions and day plans, and
  `estimatedFtpWatts` (optional, nullable) on block week summaries and week
  plans.
- `averagePower` and `normalizedPower` (optional) on activity summaries.
- `trainingLoad.ts`: normalized power, power TSS, bike-workout TSS, daily
  exponentially weighted load, and a duration-based session estimate.

API:

- `apps/api/src/training/ftp.ts` resolves the current FTP from the profile and
  the newest dated coaching input.
- `apps/api/src/training/load.ts` resolves TSS and attaches the load series
  after every generation path, including promotion-only saves.
- `apps/api/src/coaching/activities.ts` stores power metrics while summarizing
  synced activities.
- The plan prompts include the athlete's FTP (when known), the week's FTP field,
  the per-session TSS field, and the training-load rules. The combined prompt
  version is bumped to 6.

No database migration: the new values live in the existing plan JSON.

## UI

- **Today and Tomorrow cards** show `TSS · ATL · CTL · TSB` for the day when a
  load is stored.
- **Week tab** shows `Estimated FTP: N W` in the week header and the same four
  numbers for every session row.
- **Block tab** shows each week's estimated FTP beside its target load.
- Older stored plans without the new fields render exactly as before.

## Acceptance criteria

1. An athlete whose profile states an FTP sees an estimated FTP for the current
   week and for each week of the block. The estimate stays within 70–150% of
   the stated value.
2. An athlete with no stated FTP sees no FTP estimate, even if the model returns
   one.
3. Every workout in the Week tab shows a TSS number; rest days show 0.
4. A completed activity with power is scored from its normalized power and the
   week's estimated FTP, overriding the coach's estimate.
5. A structured indoor bike workout is scored from its intervals.
6. Today, Tomorrow, and Week show ATL, CTL, and TSB for the same date with the
   same values.
7. ATL reacts faster than CTL, and TSB equals `CTL − ATL` for the day.
8. A new FTP test result in a later activity comment, manual activity, weekly
   note, or review comment becomes the baseline and floors the current and next
   week's estimate. A later survey answer update takes precedence again.
9. The full quality gates pass: typecheck, lint, format, tests.

## Testing

- Shared unit tests for power TSS, bike-workout TSS, normalized power, the
  duration fallback, and the ATL/CTL/TSB recurrence.
- API unit tests for FTP extraction and for power-vs-coach TSS resolution, the
  no-FTP case, clamping, block progression, and day/week mirroring.
- Prompt tests for the new contract fields and rules.
- Web render tests for the FTP line and the load numbers in all three views.
