# Spec: Route path parameter validation

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** `docs/specs/api-errors.md`, `apps/api/src/http/validation.ts`

## Goal

Every route path parameter is validated before a handler uses it. An invalid
one answers the shared `validation_failed` contract, exactly like an invalid
body or query, instead of a hand-written `400` or a database error.

## Problem

The manual activity routes parsed a path id with `Number(c.req.param("id"))`
and only rejected `NaN`, so `1.5` and `-1` silently addressed nothing and
`1e12` reached Postgres as an out-of-range `integer`, which surfaced as a
`500`. The diet routes and two coaching routes parsed path ids by hand with
their own `badRequest` wording, while the admin question route already used
`zValidator("param", ...)`. The rule existed in one file and nowhere else.

## Scope

- `packages/shared/src/params.ts` owns `idParamSchema`: a route-param object
  whose `id` is coerced to a positive integer no larger than `2_147_483_647`,
  the largest value a PostgreSQL `serial` id holds. `1.5`, `-1`, `0`, `1e12`
  and a non-numeric id are refused before any query sees them. It is shared
  because the diet, admin and coaching routes all use it.
- `apps/api/src/routes/coaching/schemas.ts` owns the param schemas only the
  coaching routes need: `activityIdParamSchema` (a bounded, non-empty activity
  id — a Garmin id or a manual entry's id, both text) and `reviewParamSchema`
  (a review's `kind` and `startDate`). An unknown kind or a malformed date is
  now a validation failure instead of a hand-written `400`.
- Every route validates its path parameters with the shared
  `zValidator("param", schema)` and reads `c.req.valid("param")`. The handler
  takes the parsed value — a `number` for an id, a `ReviewKind` for a review —
  and no longer parses or range-checks it.
- `apps/api/src/routeParamGuard.test.ts` scans the production route files and
  fails when one reads `c.req.param(...)` directly, so a new route cannot
  reintroduce a hand-parsed parameter. It runs in the existing unit-test job.

## Out of scope

- The status of a validation failure. An invalid parameter stays `400`; only
  its body changes to the shared contract with `code: "validation_failed"` and
  the Zod issues under `details.issues`.
- Changing which ids exist. The manual activity id is still checked for
  existence by the handler, which answers `404` for an id it cannot find.

## Acceptance criteria

1. `PATCH /api/diet/entries/1.5`, `GET /api/diet/entries/1e12/photo`,
   `PUT /api/coaching/activities/manual/-1`,
   `DELETE /api/coaching/activities/manual/1e12`,
   `POST /api/coaching/coach-questions/abc/answer` and
   `POST /api/coaching/reviews/month/2026-10-13/comments` each answer a `400`
   whose body is the shared contract with `code: "validation_failed"` and at
   least one issue.
2. A valid id still reaches the handler as a number, and a valid review kind
   and date still reach it as `ReviewKind` and `string`.
3. No production route file under `apps/api/src/routes` calls `c.req.param`.
4. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test` and
   `bun run check:unused` pass.

## Data model and API impact

No schema or migration. The API contract is unchanged except that an invalid
path parameter now answers the shared `validation_failed` contract instead of a
route-specific `bad_request` or a `500`.
