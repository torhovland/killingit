# Diet progress targets

- **Status:** Accepted (implemented)
- **Date:** 2026-11-07
- **Related:** `docs/specs/diet-coaching.md`, `docs/specs/diet-log.md`,
  `docs/specs/fitness-page.md`, `docs/specs/coach-plan-lifecycle.md`,
  ADR 0020, ADR 0021.

## Goal

When the athlete has enabled diet advice and stated a diet goal, the plan should
say how their body is expected to move toward that goal at each level, not only
what to eat today. The progress is the coach's judgement, not a formula in the
app, and it does not have to be linear: a muscle-building block, a taper, or a
race week may hold weight, and a later block can lose more.

The Fitness page's Body chart can also show the expected progress as a dotted
line from today to the end of the season, so the athlete can see where the plan
is taking them.

## Scope

- The season plan carries an end-of-season target and one target per block.
- The block plan carries an end-of-block target and one target per week.
- The week plan carries an end-of-week target.
- Each target is a coach estimate of body weight and body-fat percentage at the
  end of that period, plus a short note explaining the expected progress.
- A plan refresh re-plans the targets at the levels it returns, using the latest
  tracked weight and body-fat measurements.
- The Diet page says that the default goal can be replaced on the Coaching
  Survey when the goal shown is not the athlete's own.
- The Body chart gains an optional season view: future dates run to the season
  end and the coach's targets are drawn as a dotted line.

## Out of scope

- The app calculating a deficit, a rate of change, or a target weight. Every
  number comes from the coach.
- A target on the day plan. Daily calorie estimates already cover each day.
- Persisting targets for a completed week after it leaves the stored plan. The
  completed block target survives in the season plan; a completed week's target
  is not kept in a separate table.
- Weight or body-fat editing outside the existing profile, comments, and Garmin
  sync.

## Data model

`dietProgress` is a nullable object on the season, each season block summary,
the block, each block week summary, and each week:

```json
{
  "targetWeightKg": 81.5,
  "targetBodyFatPercent": 19.0,
  "note": "Hold weight through the build block, then lose 2 kg in the base block."
}
```

- The target is the value expected on the last day of the period that owns it.
  The season's own target is for the season end, a season block's target is for
  that block's end, a block week's target is for that week's end, and a week's
  target is for that week's end.
- Either number may be null when the coach cannot estimate it. `note` is always
  present and can carry the progress when neither number applies.
- The fields are optional so plans stored before this feature parse unchanged.
  A missing or null `dietProgress` means no target for that period.
- `dietPlanSchema.goalProvided` records whether the athlete stated the goal.
  Older plans omit it; the API infers the default from the exact
  `DEFAULT_DIET_GOAL` wording.

## Prompt

`DIET_PROGRESS_RULES` is part of `PLAN_PROMPT_RULES`, so every plan prompt sees
it: the season, first block, week, day, and unified update prompts.

- The coach plans progress only when diet advice is enabled and the athlete has
  stated a goal. With diet advice off, or with only the default maintenance
  fallback, every `dietProgress` is null.
- The target at each level reflects that period's training focus. The rule
  explicitly allows a muscle-building block, a taper, or a race week to hold
  weight or gain slightly, and a later block to lose more.
- The coach bases the targets on the tracked weight and body-fat history and the
  athlete's stated goal, and re-plans the requested levels when a new measurement
  is ahead of or behind the earlier target.
- A plan update always refreshes the targets on every level it returns, even
  when the revision keeps that level's training unchanged. The API merges only
  the `dietProgress` fields, so sessions, dates, focus and rationale stay as
  supplied.
- When a stated goal has a current or future period without a target,
  `GET /api/coaching/plan` reports `pending.dietProgress`. The client then makes
  a progress-only update, and a full build makes one after the daily step when
  the finished draft is incomplete.
- The plan context renders the stored targets in the season, block, and week
  summaries, so a later prompt can revise or keep them rather than inventing a
  competing plan.
- The diet goal context says whether the goal was stated by the athlete or is
  the default, so the coach knows when to leave the targets null.

## API

- `GET /api/diet/summary` adds `goalProvided: boolean`. It is true only when the
  coach marked the goal as the athlete's own; a missing flag on an older plan is
  inferred from whether the goal equals the default wording.
- `GET /api/fitness` adds:

  - `seasonEndDate: string | null` — the stored season's last day.
  - `dietTargets: [{ date, weightKg, bodyFatPercent }]` — the coach's targets
    from today onward, one point per period end, ascending. Duplicate dates are
    merged; the more specific weekly target wins per measure over the block and
    season targets. The list is empty when diet advice is off or no target
    exists.

- The Body chart uses those targets to draw its dotted projection. No new
  endpoint or query parameter is needed: the chart extends its own x-axis on the
  client when the athlete opts in.

## UI

- The Season tab shows the season-end target and each block's target.
- The Block tab shows the block-end target and each week's target.
- The Week tab shows the week-end target.
- Targets appear only when diet advice is on, so turning it off hides all diet
  content.
- The target line shows weight in kilograms and body fat as a percentage, and
  renders the coach's note with the shared formatted text component.
- On the Body chart, a checkbox offers "Include future dates to the end of the
  season" when diet targets exist. When selected, the x-axis runs to the season
  end and the diet targets are drawn as a dotted line with markers. The line
  starts from the current chart value and joins each future target.
- The Diet page shows a note when the goal is the default: the athlete can
  provide their own diet goal on the Coaching Survey, with a button that opens
  the survey.

## Acceptance criteria

1. A generated season plan carries `dietProgress` for the season and each block;
   the first block carries it for the block and each week; the week carries it
   for the week end.
2. Each target carries `targetWeightKg`, `targetBodyFatPercent`, and `note`, and
   either number may be null.
3. The coach leaves every target null when diet advice is off or the goal is the
   default maintenance fallback.
4. A season refresh, weekly update, or daily update re-plans the targets it can
   return from the latest weight and body-fat history.
5. The Season, Block, and Week tabs show the targets when diet advice is on.
6. The Diet page shows the default-goal note and a Coaching Survey action when
   the goal was not provided by the athlete.
7. The Body chart offers the season view only when targets exist; selecting it
   extends the chart to the season end and draws the dotted target line.
8. Old plans without `dietProgress` or `goalProvided` parse and render
   unchanged.
9. Typecheck, lint, format, and tests pass.

## Testing

- Shared schemas: diet progress targets on every plan level, the nullable
  numbers, `goalProvided`, and the summary flag.
- Prompt tests: the progress rule's focus-aware, non-linear planning, the
  default/diet-advice guard, and the contracts on every level.
- Plan context tests: stored targets and goal status appear in the season,
  block, and week renders.
- API tests: the diet summary flag and fallback inference; the fitness targets
  flattened from season, block, and week progress, merged per date, and omitted
  when diet advice is off.
- Web tests: targets on the Season, Block, and Week tabs; the default-goal note
  and survey action; the Body chart checkbox and dotted target path; the
  projection helper's start point, future filtering, and interpolation.
