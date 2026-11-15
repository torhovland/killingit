# Spec: One plan validation error helper

- **Status:** Accepted (implemented)
- **Date:** 2026-11-15
- **Related:** `docs/specs/coach-plan-lifecycle.md`, `docs/specs/api-errors.md`,
  `docs/specs/season-block-boundaries.md`, ADR 0038

## Goal

A coach response that cannot be stored is rejected with a reason the athlete can
act on, and every rejection ends with the same instruction: regenerate the plan.
That sentence lives in one place, so a new check cannot spell it differently or
forget it.

## Scope

### In scope

1. `PlanValidationError` in `apps/api/src/plans/planValidationError.ts`. Its
   constructor takes the reason without the shared instruction and appends
   `Please regenerate the plan.` exactly once.
2. Every plan check throws it: the shared validation in `plans/validate.ts`, the
   season and block refresh checks in `plans/revision.ts`, the update merge in
   `plans/generation/applyUpdate.ts` and the update path in
   `plans/generation/revision.ts`.
3. A guard test (`plans/planValidationError.test.ts`) fails when a production
   module under `apps/api/src` spells the instruction out instead of throwing the
   helper.

### Out of scope

- Changing any message text. The helper reproduces the existing sentences byte
  for byte, so the plan section and the existing tests keep the same wording.
- A new `ApiErrorCode`. Plan generation runs inside the POST and its reason is
  polled from the `plan_generations.error` column, not answered through the
  error contract, so a code has no route to the client. If the plan section ever
  needs to branch, that is a change to the status contract, not to this helper.
- Recognising the failure in the web client by type. The client receives a
  stored string, not an exception, so the class is a server-side tool only.

## Athlete-facing text

`PlanValidationError` does not extend `AthleteFacingError`. Its reason describes
a model fault — the coach returned a season that does not cover today — which
the athlete cannot repair; ADR 0038 therefore maps a failed run to
`PLAN_FAILED_MESSAGE` ("The plan could not be generated. Try again.") and keeps
the detailed reason in the prompt and server logs. That preserves the behaviour
before the refactor.

## Acceptance criteria

1. A rejected plan's message is the reason, one space, and `Please regenerate the
plan.`, with the same text as before the refactor.
2. No production module under `apps/api/src` writes the instruction by hand; the
   helper is the only occurrence, enforced by the guard test.
3. `planFailureMessage(new PlanValidationError(...))` is `PLAN_FAILED_MESSAGE`.
4. Typecheck, lint, format, the unused-export check and every test suite pass.

## Data model and API impact

None. The change moves a string constant behind a class; it touches no schema,
route or wire contract.
