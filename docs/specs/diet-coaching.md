# Diet coaching

- **Status:** Accepted (implemented)
- **Date:** 2026-11-07
- **Related:** `docs/specs/diet-log.md`, ADR 0019, ADR 0020,
  `docs/specs/fitness-page.md`, `docs/specs/coach-plan-lifecycle.md`.

## Goal

Coach the athlete's diet against a stated goal, their tracked weight, the
calories they log, and an estimated daily calorie requirement that changes with
the training planned for each day. The coach — not a formula in the app — judges
whether the weight trend is on track and whether the deficit or surplus should
be higher or lower.

## Scope

- The coach returns a diet goal and a weight-trend assessment with the plan.
  When the athlete states no goal, the goal is maintenance of current weight.
  The plan also carries the coach's expected progress toward a stated goal at
  the end of the season, each block, and each week; see
  `docs/specs/diet-progress-targets.md`.
- Every week session and every day plan carries `estimatedCaloriesKcal`, the
  coach's estimate of the calories that day needs to keep the athlete on target,
  and a `calorieBreakdown` of base metabolism, workout requirement and diet
  deficit whose sum is the requirement. See
  `docs/specs/calorie-breakdown.md`.
- The Week tab shows each day's estimate. The Day tab shows it for today and
  tomorrow; the Today card also shows the breakdown, the calories logged so far
  and what is remaining.
- The Diet page puts the goal and assessment at the top, shows today's needed,
  logged and remaining calories below it, and groups the food log under each day
  with logged calories, the coach's requirement, and the deficit or surplus.
- The Fitness page shows a calorie chart below the body chart: a bar for the
  calories logged each day and a line for the coach's estimate for that day.

## Data model

Plan JSON:

- `coach_plans.diet` is `{ "goal": string, "goalProvided": boolean, "assessment": string } | null`.
  `goalProvided` is missing on plans stored before it existed.
- `week.sessions[].estimatedCaloriesKcal` and
  `today`/`tomorrow.estimatedCaloriesKcal` are optional non-negative integers.
  They are missing on plans stored before diet coaching, so every view hides
  the number when it is absent.
- `week.sessions[].calorieBreakdown` and
  `today`/`tomorrow.calorieBreakdown` are optional `{ basalMetabolismKcal,
workoutCaloriesKcal, dietDeficitKcal }` objects. The allocated intake is their
  sum (base plus workout minus deficit); a negative deficit is a surplus. They
  are missing on plans stored before the breakdown, which keep using the single
  total.

Persistent daily targets:

- `plan_day_calories` stores `user_id`, `date`, `calories_kcal`, the optional
  `basal_metabolism_kcal`, `workout_calories_kcal` and `diet_deficit_kcal`, and
  timestamps, unique per user and date. It is written from the current and next
  week whenever a plan is saved, so the Diet and Fitness pages keep the target
  the athlete was following after the coach moves on to the next week.
- The table is rewritten for a date whenever a plan covering that date is saved;
  an older date's row stays after it leaves the stored plan. A row written
  before the breakdown columns existed has null parts.

## API

- `GET /api/diet/summary?today=YYYY-MM-DD` returns
  `{ goal, assessment, days: [{ date, neededCaloriesKcal, calorieBreakdown,
consumedCaloriesKcal, balanceKcal, entries }] }`. `balanceKcal` is consumed
  minus needed, so a negative number is a deficit. `calorieBreakdown` is null
  for a target stored without one. Every day with a meal is included, plus
  today's target before the first meal is logged, newest first. It returns an
  empty summary when diet advice is off.
- `GET /api/fitness` adds `nutrition: [{ date, consumedKcal, neededKcal }]` for
  the same window as the other charts. `consumedKcal` is null when no meal on
  that day was analysed; `neededKcal` is null when no target is stored.
- `POST /api/diet/entries` is unchanged. The public `FoodEntry` now also carries
  `eatenDate`, so the page can group meals by the athlete's local day.

## Prompt

`DIET_PLANNING_RULES` is shared by the prompts that return week or day objects:

- The diet goal comes from the athlete's own words. With no stated goal the
  coach reports maintenance.
- The coach judges the weight trend from the tracked weight history and the
  logged calories against its earlier targets. The app never computes a deficit
  or a rate of loss.
- The coach sets `estimatedCaloriesKcal` and a `calorieBreakdown` on every week
  session and on the today and tomorrow day objects. The allocated intake is
  the whole day's total — food and drink — never a deficit, a surplus, or the
  calories burned in training. A hard training day is higher than a rest day,
  and the coach sanity-checks the allocated total against body weight. The app
  rejects a generated value below `MIN_PLAUSIBLE_CALORIES_KCAL` (1,200 kcal)
  with a repair request, and hides a stored value below that floor instead of
  showing a deficit as a requirement. A generated plan that carries a calorie
  total without the breakdown is also rejected for repair; a stored plan without
  one is left alone.
- The breakdown's parts are rough when little food and weight history exists.
  The prompt asks the coach to say so in `diet.assessment`, name the observation
  that will refine them, and adjust base metabolism, workout burn and deficit to
  the observed weight trend as meals and weigh-ins accumulate.
- The plan context includes the athlete's earlier calorie targets for the last
  28 days, so the assessment can compare the intake with the requirement.

## Acceptance criteria

1. A generated plan carries `diet.goal` and `diet.assessment`, and every week
   session and day plan carries `estimatedCaloriesKcal` and its breakdown.
2. With no stated diet goal the coach reports `Maintain current weight`.
3. A generated calorie target below 1,200 kcal is rejected and repaired; a stored
   value below that floor is hidden rather than shown as the day's requirement.
4. The Week tab shows every day's estimate, and the Day tab shows today's and
   tomorrow's.
5. The Today card shows the breakdown, logged calories and remaining calories,
   and updates after a meal is logged.
6. The Diet page shows the goal and assessment at the top, today's calorie
   panel, and each day's logged and needed calories with its deficit or surplus,
   with the meals under that day.
7. The Fitness page shows a calories bar chart with a needed-calories line under
   the body chart.
8. Saving a plan records each day's target in `plan_day_calories`, and the
   target survives the week leaving the stored plan.
9. Typecheck, lint, format, and tests pass.

## Testing

- Shared schemas: the diet plan and summary shapes, and `FoodEntry.eatenDate`.
- API unit tests: `dayCaloriesForPlan`, `consumedCaloriesByDate`,
  `buildDietSummary`, and the implausible-calorie and missing-breakdown guards.
- API route tests: the summary's goal, assessment, per-day balance and entries,
  and the empty summary when diet advice is off.
- Fitness history tests: logged and needed calories for each day.
- Prompt tests: the diet rule's maintenance default, trend judgement and
  per-day estimate, and the new top-level keys.
- Web tests: the calorie panel on the Today plan, the week-session estimate, the
  Diet page goal/today/day groups, and the nutrition chart's bars and line.
