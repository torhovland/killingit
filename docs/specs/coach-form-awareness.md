# Spec: Coach awareness of projected form (TSB)

- **Status:** Accepted (implemented)
- **Date:** 2026-11-04
- **Related:** `docs/specs/training-load.md`, `docs/specs/coach-plan-prompts.md`,
  `docs/adrs/0012-training-load-and-ftp-estimation.md`.

## Goal

The API already calculates each day's training stress score and the fitness
snapshot: `ATL`, `CTL`, `TSB = CTL − ATL`, and a form label from `TSB`. The UI
shows them on the Today, Tomorrow, Week, and Fitness views, but the plan prompts
received only each session's `estimatedTss`. The coach could not see whether a
planned week would push the athlete outside the Productive band.

The coach should see the projected form across the planned week and usually keep
the athlete inside Productive, deviating only with a stated reason.

## Scope

### In scope

1. Render the projected training load for every week session and day plan that
   carries one:
   `ATL 65 · CTL 45 · TSB -20 · Productive`.
2. Give every plan prompt the athlete's current form (today's ATL, CTL, TSB and
   label), so a new week or a fresh plan starts from a known TSB.
3. A shared prompt rule that names the TSB bands, states that the Productive
   band is the default target, and requires a reason for a recovery, taper, or
   deliberate overload that leaves it.
4. The coach reply context carries the same current form as the plan prompts.

### Out of scope (deferred)

- Recomputing TSB from the coach's proposed sessions inside a single completion.
  The API applies the load after the response, as today.
- A new TSB column in the plan UI; the existing views already show it.

## Acceptance criteria

1. `formatWeekPlan` appends `ATL … · CTL … · TSB … · <Label>` to each session
   that has a `trainingLoad`, and leaves sessions without one unchanged.
2. `formatDayPlan` adds a `Projected load:` line for the same values when the
   day has a `trainingLoad`.
3. `formatPlanContext` renders `Current form (YYYY-MM-DD): ATL … · CTL … · TSB …
· <Label>` when the context carries today's `trainingLoad`.
4. A prompt rule in `promptRules.ts` states the TSB bands, the Productive target
   and the reasons that justify leaving it; every plan prompt composes it
   through `TRAINING_LOAD_RULES`.
5. When no stored plan carries today's load, the current form is calculated
   from recorded activities and manual TSS, and omitted when there is no load
   history.
6. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.

## Data-model / API impact

No database, route, or response-shape change. `PlanContextInput` gains an
optional `currentForm` (`TrainingLoad | null`) used only for prompt rendering.
`currentTrainingLoad()` in `apps/api/src/training/load.ts` derives today's
snapshot from the same recorded activities, manual TSS, and threshold timelines
that `applyTrainingLoad` already consumes.

## Technical approach

- `apps/api/src/llm/planLevelsContext.ts` owns the level text format, using the
  shared `FORM_INTERPRETATION_LABELS` and `interpretTrainingStressBalance` so the
  prompt and the UI cannot describe the same TSB differently.
- `formatWeekPlan` and `formatDayPlan` add the load inline; the stored
  `trainingLoad` already exists on week sessions and day plans.
- `formatPlanContext` renders the current form before the recent activities.
- `baseContext()` supplies the stored `plan.today.trainingLoad` when it exists,
  otherwise the value from `currentTrainingLoad()`. `loadReplyContext()` uses the
  same fallback so a coach reply starts from the same picture.
- `TRAINING_LOAD_RULES` gains `FORM_TARGET_RULES`, so the initial build, the
  combined prompt, every update, and the reviews that compose it share one rule.

## Testing

- Unit tests for the week, day, and context rendering, including the missing
  `trainingLoad` case.
- A unit test for `currentTrainingLoad` from recorded activities and manual TSS.
- A prompt-rule test that the Productive target and the deviation reasons reach
  the shared training-load fragment.
- Run `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`.
