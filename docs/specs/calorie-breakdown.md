# Calorie requirement breakdown

- **Status:** Accepted (implemented)
- **Date:** 2026-11-08
- **Related:** `docs/specs/diet-coaching.md`, `docs/specs/diet-log.md`,
  ADR 0020, ADR 0025.

## Goal

Show how the coach arrived at today's calorie requirement instead of a single
unexplained number. The Today card and the Diet page break the requirement into
base metabolism, the workout requirement, and the diet deficit, and show the
allocated intake they add up to. The athlete can see which part changes when
training changes, and the coach can explain that the parts are rough until
enough meals and weigh-ins exist to refine them.

## Scope

- Every week session, today and tomorrow carry a `calorieBreakdown` object:

  ```json
  {
    "basalMetabolismKcal": 1900,
    "workoutCaloriesKcal": 500,
    "dietDeficitKcal": 300
  }
  ```

- `basalMetabolismKcal` is the coach's base energy use for the day — resting
  metabolism plus ordinary daily activity — before the planned workout.
- `workoutCaloriesKcal` is the extra energy the planned session burns. It is 0
  on a rest day.
- `dietDeficitKcal` is the planned deficit. It is 0 for maintenance and
  negative for a planned surplus, so the same equation covers every goal.
- The allocated intake is `basalMetabolismKcal + workoutCaloriesKcal -
dietDeficitKcal`. That sum, not a separately returned total, is the day's
  requirement whenever a breakdown is present.
- `estimatedCaloriesKcal` remains for older plans and as the coach's own total.
  A plan stored before the breakdown existed parses unchanged and shows the
  single "Needed" value it always did.

## Data model

Plan JSON:

- `week.sessions[].calorieBreakdown` and `today`/`tomorrow.calorieBreakdown`
  are optional and nullable on parse, so older stored plans remain valid.
- `estimatedCaloriesKcal` is unchanged. New prompts ask the coach to set it to
  the breakdown's allocated total, but readers use the breakdown when present.

`plan_day_calories` gains nullable `basal_metabolism_kcal`,
`workout_calories_kcal` and `diet_deficit_kcal` columns. The row is written from
the plan when a plan is saved, so the Diet page keeps the breakdown after the
day leaves the stored plan. A row written before the columns existed, or a
target the coach returned without a breakdown, has nulls and shows the single
requirement.

## Prompt

`DIET_PLANNING_RULES` asks the coach to:

- set `calorieBreakdown` on every week session and on the today and tomorrow day
  objects;
- estimate base metabolism from body weight, age, sex and the athlete's normal
  day, estimate the workout burn from the planned session, and state the planned
  deficit (0 for maintenance, negative for a surplus);
- keep the allocated total plausible for a whole day's intake, with the same
  1,200 kcal safety floor as before;
- say in `diet.assessment` when the parts are rough because the food log and
  weight history are thin, name the observation that will refine them, and
  adjust the parts to the observed weight trend as meals and weigh-ins
  accumulate;
- keep a real deficit when the athlete states a weight-loss or body-fat-loss
  goal. Missing food-log or weight data changes the size and confidence of the
  starting deficit, never its direction: the prompt asks for a conservative
  best-effort deficit (usually 200-500 kcal per day) instead of maintenance
  calories. A body-fat goal needs no separate weight target. A hard block or race
  preparation changes the size and timing of the deficit; only a taper, race day,
  recovery week or muscle-building block may hold it at 0, and the coach must
  explain that hold in `diet.assessment` and the period's `dietProgress` note.

A generated plan that carries a calorie total but no breakdown is rejected with
a repair request. A stored plan without one is not marked pending, so the app
never mass-regenerates old plans just to add the breakdown.

## Display

`CalorieBalancePanel` shows the requirement as a small equation:

```
Base metabolism     1900 kcal
Workout requirement  +500 kcal
Diet deficit         −300 kcal
Allocated today     2100 kcal
```

A negative deficit is labelled `Diet surplus` with a `+` value. Logged and
remaining calories follow the equation. The panel notes that the numbers are
estimates that improve as meals and weight are logged. When no breakdown is
stored, the panel falls back to the single "Needed" value.

The Day tab shows the breakdown for today. The Diet page shows it in its Today
panel, reading the stored target from `GET /api/diet/summary`. Tomorrow and the
Week tab keep their single `N kcal needed` line.

## Acceptance criteria

1. A generated plan carries `calorieBreakdown` on every week session, today and
   tomorrow, and the allocated intake is its sum.
2. A generated plan with a calorie total but no breakdown is rejected and
   repaired.
3. A stored plan from before the breakdown still parses and shows its single
   needed value.
4. Saving a plan records the breakdown with the day's total in
   `plan_day_calories`.
5. The Day tab's today panel shows Base metabolism, Workout requirement, Diet
   deficit (or Diet surplus), and Allocated today, then Logged and Remaining.
6. The Diet page's Today panel shows the same breakdown.
7. A deficit of 0 shows maintenance, and a negative deficit increases the
   allocated total.
8. The prompt tells the coach to refine the parts from the observed weight trend
   and logged intake, and to say when the numbers are still rough.
9. A stated weight-loss or body-fat-loss goal keeps a non-zero deficit even with
   little food-log and weight history; only a deliberately explained hold may
   use 0.
10. Typecheck, lint, format, and tests pass.

## Testing

- Shared: the breakdown schema, `allocatedCaloriesKcal`, and
  `plannedCaloriesKcal` preferring the breakdown and hiding an implausible sum.
- API: `calorieEstimateProblems` requiring the breakdown in generated plans,
  checking the breakdown's sum, and leaving older stored plans alone;
  `dayCaloriesForPlan` recording the sum and breakdown; the diet summary carrying
  the stored breakdown.
- Prompt: `DIET_PLANNING_RULES` and the day/week contracts name the three parts
  and the uncertainty instruction.
- Web: the calorie panel's equation, deficit and surplus labels, estimate note,
  and the fallback for a target without a breakdown; the Today card and Diet
  page rendering the breakdown.
