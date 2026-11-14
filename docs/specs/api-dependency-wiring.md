# API dependency wiring

## Goal

Give the API one injectable dependency surface so wiring a route is a plain
list, and so adding an injectable touches at most two files. This replaces the
per-route dependency interfaces and the conditional spreads that every route
factory needed under `exactOptionalPropertyTypes`.

## Scope

- `apps/api/src/dependencies.ts` owns the dependency types:
  - `AppDependencies` is the flat, fully optional surface that tests pass to
    `createApp`. Every optional field is typed `T | undefined`.
  - `ResolvedAppDependencies` adds the account stores (`userStore`,
    `answerStore`, `coachingSurveyAdjustments`, `planStore`, `generationStore`)
    that `createApp` resolves once.
  - `planTriggerDependencies` maps the shared context onto
    `PlanTriggerDependencies`, the contract for a plan run.
- `createApp` resolves the stores once and forwards the whole context to the
  plan, coaching, fitness, calendar, diet and weather factories:
  `createPlanRoute(deps)`, `createCoachingRoute(deps)`, and so on. The route
  table in `apps/api/src/index.ts` reads as a list.
- Those route factories accept `ResolvedAppDependencies` and apply their own
  production default with `?? ` when they consume an optional injectable.
- The Garmin and LLM routes keep their local hook interfaces because their
  tests drive the factories directly with a transport stub; neither needs a
  shared-context field, because the account comes from the auth middleware and
  `getUser(c)`.
- The coaching route still resolves its short handler names and the plan-run
  bundle in `routes/coaching/dependencies.ts`, but it does so from the shared
  context instead of a second dependency interface.

## Rules

- Do not declare a per-route dependency interface or conditionally spread
  dependency fields. Forward the field directly; the consumer applies the
  default.
- Adding an injectable means adding it to `AppDependencies` and using it in the
  route. If plan generation needs it, also add it to the mapping in
  `dependencies.ts` and to `PlanTriggerDependencies`.
- Every loader and writer a plan run uses is a `PlanTriggerDependencies` field,
  so tests can run a plan without a database. The plan run's advisory prompt
  inputs are fail-open; the account's own state and the activity feed are
  required. See `docs/specs/plan-input-loading.md`.
- Keep an injectable optional where absence has meaning. A plan run treats an
  absent `loadActivities` as "sync first" and an absent `loadLlm` as "use the
  season model", so those are not resolved centrally.
- Route handlers read the signed-in account with `getUser(c)`. They never take
  a `UserStore` to provision it; the auth middleware resolves it once. See
  `docs/specs/authenticated-user-middleware.md`.
- Tests keep injecting through `createApp`; they must not need changes for a
  wiring refactor.

## Acceptance criteria

- Adding an injectable touches at most two files.
- Route wiring in `createApp` and the plan-run mapping are readable lists.
- Existing route tests pass unchanged.
