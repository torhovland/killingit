# ADR 0025: Show a calorie breakdown and let the coach refine it

- **Status:** Accepted
- **Date:** 2026-11-08
- **Deciders:** torhovland
- **Related:** ADR 0020, `docs/specs/calorie-breakdown.md`,
  `docs/specs/diet-coaching.md`.

## Context

ADR 0020 stores one `estimatedCaloriesKcal` per day. It is the whole day's
intake, but it is an opaque number: the athlete cannot see how much of it comes
from simply being alive, how much from the planned workout, and how much from
the diet deficit. When the coach changes the workout or the deficit, the single
number moves without explaining which part changed. A single number also hides
that it is a rough guess when the food log and weight history are thin.

## Decision

### The coach returns the three parts, and the app sums them

Every week session, today and tomorrow carry a `calorieBreakdown`:
`basalMetabolismKcal`, `workoutCaloriesKcal` and `dietDeficitKcal`. The allocated
intake is their sum, base plus workout minus deficit. A negative deficit
represents a planned surplus, so the same contract covers weight loss,
maintenance and muscle-building blocks.

The app displays the sum rather than trusting a separate total. The older
`estimatedCaloriesKcal` remains on the plan for backward compatibility and as the
coach's own total, but a breakdown, when present, wins in every reader. This
keeps the equation on screen internally consistent even when a model's total
rounds differently.

### The parts are estimates, and the coach owns their refinement

The coach estimates base metabolism from the athlete's body, estimates the
workout burn from the planned session, and states the planned deficit. The app
never calculates any of them. The prompt tells the coach to say when the parts
are rough and which observation will refine them, and to adjust them to the
observed weight trend as meals and weigh-ins accumulate. This follows ADR 0020's
rule that the coach, not a formula, judges the deficit.

### Persist the breakdown with the daily target

`plan_day_calories` gains three nullable columns. The row is written whenever a
plan is saved, so the Diet page can show the breakdown for today after the week
has left the stored plan. Old rows and targets returned without a breakdown keep
nulls and show the single requirement.

## Consequences

- A generated plan without a breakdown is rejected and repaired; a stored plan
  from before the breakdown stays valid and is not mass-regenerated.
- The breakdown is stored per day rather than per athlete, because the workout
  requirement changes with the planned session even though base metabolism
  usually does not.
- The Week tab and tomorrow keep a single requirement line; only today shows the
  equation, so the extra detail does not crowd the plan.
- The remaining-calories number follows the breakdown's sum, so logging a meal
  and reading the equation cannot disagree.
