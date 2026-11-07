# ADR 0020: Diet coaching with per-day calorie targets

- **Status:** Accepted
- **Date:** 2026-11-07
- **Deciders:** torhovland
- **Related:** ADR 0019, `docs/specs/diet-coaching.md`,
  `docs/specs/diet-log.md`.

## Context

The diet log records meals and estimates their calories, but it cannot coach
the athlete toward a diet goal. The coach needs a daily calorie requirement that
changes with the training planned for that day, and it needs to judge the
tracked weight trend against the intake instead of applying a fixed formula.
The app already receives the athlete's diet goal in the coaching survey and
tracks weight in the metric series.

## Decision

### The plan carries the goal and the per-day estimate

Add a top-level `diet` object to the plan with the athlete's goal and the
coach's weight-trend assessment. Add `estimatedCaloriesKcal` to every week
session and day plan. The same `DIET_PLANNING_RULES` fragment drives the weekly,
daily, plan-update and full plan prompts, so the goal, the assessment and the
per-day number always come from the coach that planned the day's training.

The app does not calculate a deficit, a rate of weight loss, or a calorie
requirement. It only stores and displays what the coach returned, and it falls
back to "Maintain current weight" when no goal was stated.

### Keep the daily target after the week leaves the plan

The stored plan only carries the current and next week. A new
`plan_day_calories` table records each day's target whenever a plan is saved, in
the same transaction as the plan. The Diet and Fitness pages read that history,
so a completed week keeps the requirement the athlete was measured against. This
mirrors `plan_week_totals`.

### One summary endpoint feeds the Diet page and the Today card

`GET /api/diet/summary` groups the food log by local day, joins each day to its
stored target, and returns the balance. The Diet page and the Today plan use the
same response, so the two panels cannot disagree. `GET /api/fitness` carries the
same nutrition series for the chart.

## Consequences

- A plan generated without a diet goal still has calorie estimates; the goal is
  simply maintenance.
- Older plans parse unchanged: `diet` and `estimatedCaloriesKcal` are optional.
- The Diet page shows every day with a meal, plus today's target before the first
  meal is logged; a missing side is null, never a false zero.
- An unanalysed meal contributes no calories, so it never reads as a zero-calorie
  meal.
- The coach sees the last 28 days of targets in its plan context, so the
  assessment can compare intake with the requirement rather than judging weight
  in isolation.
- The prompt states that the field is the whole day's total intake, not a
  deficit or burned calories. A generated value below the 1,200 kcal safety floor
  is rejected for repair, and a stored value below it is hidden, because a number
  that low is almost always a field confusion rather than a target.
