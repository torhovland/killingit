# ADR 0023: One shared dependency context for API routes

- **Status:** Accepted
- **Date:** 2026-11-08
- **Deciders:** torhovland
- **Related:** `docs/specs/api-dependency-wiring.md`

## Context

`apps/api/src/index.ts` declared a 56-field `AppDependencies` interface and
forwarded its fields to route factories through roughly 160
`...(deps.x !== undefined ? { x: deps.x } : {})` spreads. Each route then
re-declared the subset it wanted, sometimes under a different name, and the
coaching route repeated the pass-through for its plan-run child. Adding one
injectable meant editing the shared interface, a route interface, the factory
call, and the child bundle. A forgotten pass-through silently fell back to the
production default in a test, which is hard to notice.

`exactOptionalPropertyTypes` was the mechanical cause: an optional property
`x?: T` cannot receive an explicitly `undefined` value, so callers guarded every
forward with a conditional spread.

## Decision

- Type optional dependency fields as `T | undefined`. This is the supported
  `exactOptionalPropertyTypes` spelling for "may be present and undefined", and
  it makes `x: deps.x` valid without a conditional spread.
- Keep one flat `AppDependencies` surface for tests, defined in
  `apps/api/src/dependencies.ts`.
- Resolve the account stores once in `createApp` into
  `ResolvedAppDependencies`, and pass that whole context to every route
  factory. Routes keep their own `??` production defaults.
- Map the context onto the plan-run contract in one
  `planTriggerDependencies` helper rather than in every route that can start a
  run.
- Leave an injectable absent where absence is meaningful, notably the plan run's
  `loadActivities` (absent means "sync first") and `loadLlm` (absent means "use
  the season model").

## Alternatives considered

- **Domain bundles (`PlanDeps`, `ActivityDeps`, …).** Rejected: routes share
  most injectables, so bundles would duplicate fields across bundles or force a
  route to take several bundles. One context is smaller and still reads as a
  list.
- **Disable `exactOptionalPropertyTypes` for dependency files.** TypeScript has
  no per-interface flag, so this would require a second tsconfig or a build
  exception for a problem `T | undefined` already solves.
- **Resolve every injectable centrally.** Rejected: some consumers distinguish
  an absent injectable from a present one, and local defaults keep each route's
  fallback next to its use.

## Consequences

- `createApp` is a short route table and the conditional spreads are gone.
- Adding an injectable touches the shared dependency module and the consuming
  route; a plan-run injectable also touches `PlanTriggerDependencies`.
- The whole context is available to every route, so TypeScript no longer lists
  a route's exact needs. The route body and its imports document that instead.
- Tests continue to inject through `createApp` without changes.

## Amendment (2026-11-14)

Issue #293 brought the last three route families in. `createGarminRoute`,
`createLlmRoute` and the admin question route now take `ResolvedAppDependencies`
like the others; `adminQuestionsRoute` became `createAdminQuestionsRoute`, and
its five store functions became one `QuestionSetStore`. The Garmin and LLM
routes previously kept local hook interfaces because their tests drove the
factories directly; those tests now build their app with `createApp`, which is
what makes the consequence above hold. Injectables on the flat surface are
named after the production function they replace (`loadGarminCredentials`,
`loadLlmSettings`) so a bare `authenticate` or `provider` cannot be mistaken for
another route's seam.
