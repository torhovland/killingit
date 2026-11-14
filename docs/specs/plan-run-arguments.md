# Spec: Plan-run entry points take one options object

- **Status:** Accepted (implemented)
- **Date:** 2026-11-13
- **Related:** `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/plan-finalisation.md`, ADR 0013, ADR 0014.

## Goal

Keep the plan-run entry points readable as they grow: a caller states what it
wants by name instead of appending another positional boolean, and the season
refresh and the incremental advance share one function.

## Background

Four entry points that drive a plan run carried their last arguments
positionally, and three of them ended in optional booleans:

| Entry point                                                 | Arguments                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `advancePlan` (`apps/api/src/plans/generation/revision.ts`) | input, stored plan, pending flags, revision flag, season, review |
| `planPending` (`apps/api/src/plans/status.ts`)              | plan, today, include-tomorrow, weather, week-review, diet-advice |
| `PlanStore.save` (`apps/api/src/plans/store.ts`)            | user id, plan, three timestamps, run id                          |
| `buildResponse` (`apps/api/src/routes/plan.ts`)             | user id, location, zone, today, include-tomorrow, diet advice    |

`refreshStoredSeason` and `advancePendingPlan` were wrappers whose only
difference was the `seasonRefresh` boolean in the fourth position, so the
readers of a refresh run had to count arguments to see what it did.

A positional boolean is invisible at the call site (`advancePlan(input, plan,
pending, revision, true, weekReview)`), easy to transpose, and each new flag
lengthens the tail that every caller must repeat.

## Scope

### In scope

1. `advancePlan(input, current, decision)` takes the `RevisionDecision` this
   run already computed. A new `decision.kind` (`"refresh"` or `"advance"`)
   replaces the `seasonRefresh` boolean, and the two single-line wrappers are
   deleted.
2. `planPending(options)` takes one options object with `plan`, `today` and the
   four optional flags.
3. `PlanStore.save(options)` takes one options object with the user id, the
   plan, the three timestamps and the optional run id.
4. `buildResponse(options)` in the plan route takes one options object.
5. The plan modules and the plan route declare an ESLint `max-params` limit so a
   sixth positional argument cannot come back unnoticed.

### Out of scope

- Behaviour. Every call passes the value it passed before; the saved plan, the
  pending flags and the HTTP response are unchanged.
- The stored plan shape, the prompt, the database and the API contract. No
  data-model or API change.
- `applyCompletedDays` and the training-load helpers, which other plan
  refactors own.

## Target structure

- A plan-run function takes at most its input, the stored plan and the decision
  it derives from that input.
- Optional data travels in a named object with a short doc comment per field,
  not in a trailing list of booleans.
- The store interface names its arguments so a plan write reads as data rather
  than as a six-item argument order.

## Acceptance criteria

1. `advancePlan` takes three arguments and reads `decision.kind` to decide
   whether the season is refreshed in place.
2. `refreshStoredSeason` and `advancePendingPlan` no longer exist.
3. `planPending`, `PlanStore.save` and the plan route's `buildResponse` each
   take one options object.
4. Every existing unit, integration and e2e call site compiles and behaves as
   before.
5. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`,
   `bun run check:unused`, `bun run test:integration` and `bun run test:e2e`
   pass.
