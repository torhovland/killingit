# Spec: Plan generation modules

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** `docs/specs/plan-revision-steps.md`,
  `docs/specs/plan-finalisation.md`, `docs/specs/plan-run-arguments.md`,
  `docs/specs/coach-plan-lifecycle.md`, ADR 0013, ADR 0014.

## Goal

Keep `apps/api/src/plans/generate.ts` a small orchestrator. The revision
decision, the fresh build, the update engine, the prompt context and the
persistence/fencing rules each live in a module that can be read and tested on
its own.

## Background

`plans/generate.ts` held the types for a run, the orchestrator, the revision
decision, the fresh build, the update engine, the prompt context, the
completion-saving and the fencing checks. The file was large enough that a
change to one concern required reading every other concern, and its test file
covered all of them in one run.

## Scope

### In scope

1. `apps/api/src/plans/generation/types.ts` — `PlanGenerationContext`,
   `GeneratePlanInput` and the revision decision shape.
2. `decision.ts` — `decideRevisionPlan`, `planIsIdle`, ended-period review
   capture/merging and the season-coverage check.
3. `freshPlan.ts` — the fresh build, the next-period completion and the
   progress-only diet completion.
4. `revision.ts` — the update engine (`advancePlan`) and the single
   plan-update prompt (`requestPlanUpdate`).
5. `applyUpdate.ts` — applying the levels the update returned, restoring
   today's stored session while the rest of the week is revised, the
   activity-on-day check and the body-metric merge.
6. `finalize.ts` — the adapter from a run input to `FinalizePlanInput`. The
   pipeline itself stays in `plans/finalize.ts`.
7. `persist.ts` — saving, run fencing, the completion wrappers and the
   fail-open body-metric, FTP, coach-question and survey-adjustment writes.
8. `promptContext.ts` — the athlete/training prompt context, weather context,
   model selection and provider credentials.
9. `plans/validate.ts` — the plan assertions used by the finalisation pipeline.
10. `deriveTodayStatus` moves next to `activitiesOnDate` and the week
    completion rules in `plans/week.ts`.
11. `planFtpEstimates` moves to `metrics/planFtpEstimates.ts`, beside the
    metric writes it feeds.
12. The test file is split along the same seams, with the shared fixtures and
    in-memory stores in `testFixtures/generationHarness.ts`.
13. `plans/planInputs.ts` — the advisory loader dependencies
    (`PlanInputDependencies`), the `ThresholdHistory`, `BodyHistory` and
    `CalorieHistory` aliases, the prompt windows and the fail-open
    `loadPlanInputs`.
14. `plans/generationContext.ts` — `loadPlanGenerationContext` keeps the
    required inputs and the fenced failure handling; `syncAthleteReadingIfChanged`
    owns the athlete-reading decision and its post-reading fence;
    `buildPlanContext` is the one mapping from the loaded and advisory inputs to
    `PlanGenerationContext`.
15. `plans/trigger.ts` keeps the background start, the heartbeat and a short
    `runPlanForUser`: load, fence, read the athlete's text, load the advisory
    inputs, wait for a newer analysis, and run generation. Both fences go
    through `ensureGenerationCurrent`; ESLint rejects a direct
    `generations.isCurrent` call anywhere under `plans/`.
16. `plans/triggerDebounce.ts` owns the trigger debounce and coalescing:
    `PLAN_TRIGGER_DEBOUNCE_MS`, the pending per-account starts and the last
    trigger time, in a `PlanTriggerDebounce` class. `plans/trigger.ts` keeps
    the one process-local instance and schedules through it; a test constructs
    its own. First trigger immediate, a trigger inside the window replaces the
    one, explicit new-season, update-season and forced runs wait zero, the
    timer is `unref`'d, and the window arrives on every call so
    `deps.planTriggerDebounceMs` still applies. The state stays process-local
    (ADR 0014); the database run id remains the cross-instance fence.

### Out of scope

- Behaviour. The same input saves the same plan, the same status row and the
  same prompt log. The prompt text, stored plan shape, database schema and API
  contract are unchanged.
- Renaming the existing pure `plans/revision.ts` merge helpers.

## Optional prompt context

Every prompt field that may be absent is typed `T | undefined` — on
`PlanGenerationContext`, `GeneratePlanInput`, `PlanContextInput` and
`CapturePeriodReviewsInput` — and forwarded as-is. The prompt context is one
plain object shape rather than a different set of keys per run: the formatter
decides what to omit, so `baseContext`, `captureEndedPeriodReviews` and
`runPlanGeneration` contain no `...(value !== undefined ? { value } : {})`.
`promptContext.test.ts` guards the rule in `AGENTS.md`, and the formatter treats
an explicit `undefined` exactly like an absent field. See
`docs/specs/plan-input-loading.md`.

## Acceptance criteria

1. `runPlanGeneration` is a short orchestrator in `plans/generate.ts`.
2. Every extracted module has one responsibility and no behaviour change.
3. Optional prompt context is typed `T | undefined` and forwarded instead of
   conditionally spread.
4. `runPlanForUser` names its phases — load, fence, athlete reading, advisory
   inputs, analysis wait — and the prompt context is assembled by one tested
   `buildPlanContext`.
5. Typecheck, lint, format, unused-export check and the full test suite pass.
   `triggerDebounce.test.ts` covers the immediate first start, replacement
   inside the window, the explicit modes and the per-call window; `trigger.test.ts`
   keeps covering a whole plan run.
