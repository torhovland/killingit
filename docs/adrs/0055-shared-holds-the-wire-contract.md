# ADR 0055: `packages/shared` holds the wire contract, not API logic

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** `docs/specs/shared-api-boundary.md`, issue #335

## Context

`packages/shared` started as the wire contract: the Zod schemas the API sends
and the web app validates, the TypeScript types inferred from them, and a few
helpers both sides call. Over time it also collected logic that only the API
runs — the four plan-answer schemas the coach completions are parsed into, the
activity-analysis and reply answer schemas, the training-load maths, and a
handful of stored-data predicates (`isDefaultDietGoal`, the daily-health
in-progress filter, `isValidTimeZone`).

That mislocation had three costs. The shared package's public surface stopped
describing the contract, so a reader could not tell a DTO from an internal
parser. An API-only change meant editing the package the browser ships. And the
package had no stated dependency rule, so nothing stopped the next server
concern — a database read, a formatter that needs Node — from landing there.

## Decision

The rule is:

> `packages/shared` holds the wire contract — the schemas and types both sides
> exchange plus the helpers both sides use. Anything only the API computes or
> parses lives in `apps/api`, in the module that owns the concern.

Applied in this change:

- The plan-answer schemas move to `apps/api/src/llm/planResult.ts`, and the
  activity-analysis and reply answer schemas to
  `apps/api/src/llm/coachResult.ts`. The plan DTOs they compose stay shared.
- The training-load maths moves to `apps/api/src/training/stress.ts`;
  `packages/shared/src/trainingLoad.ts` keeps the `trainingLoadSchema` the wire
  carries and the form interpretation the web app reads.
- `isDefaultDietGoal` moves to `apps/api/src/diet/goal.ts`, the daily-health
  in-progress filter to `apps/api/src/metrics/dailyHealth.ts`, and the time-zone
  check to `apps/api/src/weather/timeZone.ts`.
- No re-export shim stays behind, so an old import fails to compile instead of
  quietly crossing the boundary.
- A dependency guard, `packages/shared/src/dependencyGuard.test.ts`, fails when
  a shared module imports anything but a sibling module or `zod`.

## Alternatives considered

- **A fourth package for the API-only shared code.** It would need its own
  manifest, tsconfig, knip entry and Docker copy for helpers that the API alone
  consumes, and it would hide which API concern owns each one. Rejected.
- **Keeping the symbols in shared and marking them deprecated.** A shim keeps
  every import working, which means the boundary never becomes real and the
  package surface keeps describing the API's internals. Rejected.
- **Leaving `isValidTimeZone` as the exported implementation and duplicating the
  check in the schema.** Two copies of the IANA rule can drift. The API check is
  instead derived from `timeZoneSchema`, so the schema owns the rule. Rejected.
- **Moving all of `trainingLoad.ts`.** `trainingLoadSchema`, `FORM_ZONES` and
  `interpretTrainingStressBalance` are read by the web app's fitness charts, so
  the module is split along the API/web line rather than moved whole. Rejected.

## Consequences

- The shared package shows what the wire carries. A symbol in it is either a DTO
  or a helper with consumers on both sides.
- An API-only change no longer edits the browser's package, and `check:unused`
  reports a shared export that only the API's tests used.
- `apps/api/src/llm/promptContracts.test.ts` imports the answer schemas from the
  API modules, so the prompt-versus-schema parity check still fails CI when one
  side gains a field.
- The dependency guard is a unit test, so CI's test job enforces the layering
  without a new workflow step. It is a naming and layering rule, not a proof:
  a helper both sides call legitimately stays in shared.
