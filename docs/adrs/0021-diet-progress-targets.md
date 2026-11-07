# ADR 0021: Diet progress targets planned by the coach

- **Status:** Accepted
- **Date:** 2026-11-07
- **Deciders:** torhovland
- **Related:** ADR 0020, `docs/specs/diet-progress-targets.md`,
  `docs/specs/diet-coaching.md`, `docs/specs/fitness-page.md`.

## Context

ADR 0020 gave the plan a diet goal, a weight-trend assessment, and a calorie
target for each day. It did not say where the athlete's body should be by the
end of the season, a block, or a week. That missing layer matters because diet
progress is not independent of training: a block that builds muscle is a poor
time to lose weight, while a base or taper block may be a good time to reduce
body fat. A formula that spreads a total weight change evenly across the weeks
would produce the wrong target for both.

The athlete's weight and body fat are already tracked as a dated series, and the
Fitness page already draws a best-fit projection for the next planned days. That
projection is statistical, not the coach's intent.

## Decision

### The coach returns a dated-by-period target at every plan level

Add a nullable `dietProgress` object to the season, each season block summary,
the block, each block week summary, and the week. It carries
`targetWeightKg`, `targetBodyFatPercent`, and a short `note`. The target belongs
to the last day of its period, so the API and UI do not need a date inside the
object; the season and block date ranges and the week's seven days provide it.

A target is deliberately optional and may have null numbers. This keeps older
plans valid, lets the coach say "hold weight" without inventing a number, and
avoids forcing a weight target onto a goal that is not measured in weight.

### The LLM plans the progress, and re-plans it on refresh

`DIET_PROGRESS_RULES` is part of the shared plan rules, so the season, block,
week, day and unified update prompts all see it. It tells the coach to match the
target to the period's training focus, to allow a non-linear path, and to
re-plan the levels it returns when the latest weigh-in is ahead of or behind the
earlier target. The app only stores and displays the numbers.

A stated numeric target is the destination for its goal date. The diet plan also
carries `goalWeightKg`, `goalBodyFatPercent` and `goalDate`, read from the
athlete's own words. The goal date may be mid-season; the target at that date—the
first week or block end on or after it—must reach the goal. Without a date, the
season end is the date. A goal date after the season ends is not due this season.
After a mid-season goal, a muscle-building block, a race, or a deliberate
maintenance phase may hold or gain, so the season-end target can be above the
mid-season goal.

A plan that misses an unrealistic or conflicting goal is not automatically
wrong. The coach can set `goalMissReason` with the specific conflict and what it
protects; a non-empty reason accepts the miss, and the reason is shown with the
goal. The prompt also tells the coach to front-load the loss into the early and
off-season blocks: a later block being busy is not by itself a reason to hold
weight at a high body-fat percentage for most of the season.

The target is planned only when diet advice is enabled and the athlete stated a
goal. With the default maintenance fallback the targets stay null, and the Diet
page asks the athlete to provide a goal on the Coaching Survey. This keeps the
feature honest: a goal the athlete never chose does not produce a body
projection. For a plan stored before the structured goal fields existed, the app
also reads a clear body-fat percentage from the goal text so the plan can refresh
itself; that check never writes a target.

### The Body chart gets a season view from the same targets

`GET /api/fitness` returns the season's last day and the flattened future
targets. The Body chart adds a checkbox that extends its x-axis to the season
end and draws the targets as a dotted line with markers. The line starts at the
current chart value and joins each period target. Flattening and merging live on
the API so the web app only renders what the coach planned; the web helper that
builds the line is pure and tested.

The existing best-fit body projection stays as it is. The dotted target line is
distinct because it has a different dash pattern, markers, and a legend entry.

## Consequences

- The plan grows by a small object per period; old plans parse unchanged because
  every field is optional.
- A target can go stale between a weight measurement and the next refresh of a
  level. The daily update re-plans the week, the weekly update re-plans the
  block, and a season refresh re-plans the season; the latest weight is in every
  plan prompt. A plan with a stated goal but a missing current or future target
  is reported as `pending.dietProgress`, and the next visit makes a progress-only
  update that changes only the targets. A full build makes the same progress-only
  update when its finished draft is incomplete.
- The Diet page's default-goal note is driven by `goalProvided`, with an exact
  default-wording fallback for plans stored before the flag existed.
- The Body chart's season view is client-side, so other charts keep their
  current window and the API payload stays bounded by the number of period ends.
- A completed week's target is not kept after the week leaves the stored plan.
  The completed block's target remains in the season plan, which is the
  aggregate the athlete and coach review.
