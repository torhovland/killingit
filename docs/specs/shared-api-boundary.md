# Shared package boundary

## Goal

`packages/shared` is the wire contract: the Zod schemas and TypeScript types the
API sends and the web app validates, plus the small helpers both sides genuinely
use. It had accumulated logic only one side runs — LLM answer schemas, the
training-load maths, and a few API-only predicates — which made the package look
like a general-purpose library and let server concerns drift towards the
browser. Move that logic into the API module that owns the concern, so the
boundary is real rather than a naming convention.

## Scope

Moved out of `packages/shared`:

| Symbol                                                                                                                                                                          | New home                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `seasonPlanUpdateSchema`, `initialBlockUpdateSchema`, `dailyPlanUpdateSchema`, `weeklyPlanUpdateSchema` and their types                                                         | `apps/api/src/llm/planResult.ts`      |
| `coachAnalysisResultSchema`, `coachReplyResultSchema` and their types                                                                                                           | `apps/api/src/llm/coachResult.ts`     |
| `normalizedPower`, `powerTrainingStressScore`, `bikeWorkoutTrainingStressScore`, `recordedPowerSummary`, `dailyTrainingLoad`, `estimatedTssFromSession`, `ATL_DAYS`, `CTL_DAYS` | `apps/api/src/training/stress.ts`     |
| `isDefaultDietGoal`                                                                                                                                                             | `apps/api/src/diet/goal.ts`           |
| `withoutInProgressDailyHealth` and its in-progress metric catalog                                                                                                               | `apps/api/src/metrics/dailyHealth.ts` |
| `isValidTimeZone`                                                                                                                                                               | `apps/api/src/weather/timeZone.ts`    |

Stays in `packages/shared`, because the web app reads it or the wire carries it:

- `trainingLoadSchema`, `TrainingLoad`, `FormInterpretation`, `FORM_ZONES`,
  `FORM_INTERPRETATION_LABELS` and
  `interpretTrainingStressBalance` (the load maths above uses the schema as its
  return type).
- The plan DTO schemas the moved update schemas compose: `seasonPlanSchema`,
  `blockPlanSchema`, `weekPlanSchema`, `dayPlanSchema`, `dietPlanSchema`,
  `coachResponseNotesSchema`, `bodyMetricEstimateSchema`.
- `coachAnalysisSchema` and `coachResponseNotesSchema`, which describe stored
  and returned coach text.
- `DEFAULT_DIET_GOAL`, `DAILY_HEALTH_METRICS` and `formatDailyHealthValue`.
- `timeZoneSchema` and `currentUserSchema`; the API's `isValidTimeZone` is
  derived from `timeZoneSchema`, so the rule has one owner.
- `IN_PROGRESS_DAILY_HEALTH_METRICS` moved with the filter that read it; no
  other module used it.

The moved tests came with their modules: `apps/api/src/training/stress.test.ts`,
`apps/api/src/llm/planResult.test.ts`, `apps/api/src/diet/goal.test.ts` and
`apps/api/src/weather/timeZone.test.ts`. The plan update schemas' gap — the
daily schema's "today must be one of the week's sessions" refinement — gained a
test, and `apps/api/src/metrics/dailyHealth.test.ts` covers the daily-health
filter, which had none.

## Acceptance criteria

- Nothing in `packages/shared` is exported only for `apps/api`. The API imports
  the contract; the contract does not describe the API's internals.
- `packages/shared` imports only sibling modules and `zod`. A guard test,
  `packages/shared/src/dependencyGuard.test.ts`, fails when a shared module
  reaches for the API, a driver, a framework or a Node builtin.
- `apps/api/src/llm/promptContracts.test.ts` still compares every prompt
  contract with the schema that parses the coach's answer, now importing the
  answer schemas from the API modules.
- `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`,
  `bun run check:unused` and `bun run test:coverage` pass.

## Data model and API impact

None. Every moved symbol keeps its name, signature and behaviour, so no schema,
route, prompt, migration or stored plan changes. Only the import path of each
moved symbol changes.
