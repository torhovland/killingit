# Spec: API query validation

- **Status:** Accepted (implemented)
- **Date:** 2026-11-15
- **Related:** `docs/specs/route-param-validation.md`, `docs/specs/api-errors.md`, `apps/api/src/http/query.ts`

## Goal

Every route that needs the athlete's local `today` validates it before the
handler uses it, through the shared query schema and the project's
`zValidator("query", ...)`. An invalid date answers the shared
`validation_failed` contract, exactly like an invalid body or path parameter,
instead of a route-specific message.

## Problem

Six route families copied `planDateSchema.safeParse(c.req.query("today"))` and
the hand-written message `"A valid today date (YYYY-MM-DD) is required"`, while
others copied a `today` and `timezone` object and answered `"Invalid query
parameters"`. The fitness route parsed `today`, `range` and `timezone`
separately, and the coaching feed and deletion handlers each owned another
local copy. The rule existed in one helper (`apps/api/src/http/validation.ts`)
and nowhere else, so every new route could copy the wrong message again.

## Scope

- `apps/api/src/http/query.ts` owns the query schemas the API routes share:
  - `todayQuerySchema` — `{ today: PlanDate }`, built on `planDateSchema` from
    `@killingit/shared`.
  - `timezoneSchema` — the athlete's optional IANA zone, a bounded non-empty
    string.
  - `todayWithTimezoneQuerySchema` — `today` plus `timezone`, the shape a day
    boundary or a mutation needs.
- A route that also accepts another field composes the shared schema instead of
  copying it: the fitness route extends `todayQuerySchema` with `range` and
  `timezone`, and the activity feed derives its optional `today` through
  `.partial()`.
- Every handler reads the parsed value through `c.req.valid("query")`. Where a
  route is wired in `apps/api/src/routes/coaching/index.ts`, the
  `zValidator("query", ...)` runs on the Hono route and the handler takes the
  parsed value. No route parses `c.req.query("today")` or calls
  `planDateSchema.safeParse` itself.
- `apps/api/src/routeQueryGuard.test.ts` scans the production route files and
  fails when one parses `today` by hand. It runs in the existing unit-test job.
  It ignores legitimate schema composition such as
  `today: planDateSchema.optional()`.

## Out of scope

- The status of a validation failure. An invalid query stays `400`; only its
  body changes to the shared contract with `code: "validation_failed"` and the
  Zod issues under `details.issues`.
- Response shapes and route paths, which are unchanged.
- Route inputs other than `today` that a handler reads directly, such as the
  plan route's `includeTomorrow` flag, which this refactor leaves alone.

## Acceptance criteria

1. `GET /api/calendar`, `GET /api/fitness`, `GET /api/coaching/plan`,
   `GET /api/diet/summary`, `GET /api/coaching/weekly/notes`,
   `GET /api/coaching/activities`, `GET /api/coaching/activities/cached`,
   `DELETE /api/coaching/activities/:activityId` and
   `DELETE /api/coaching/activities/manual/:id` reject a missing or malformed
   `today` with a `400` whose body is the shared contract with
   `code: "validation_failed"`, the default message `"The request is not
valid"` and at least one issue.
2. A valid `today` still reaches the handler as a `PlanDate`, and an absent
   `timezone` still falls back to the athlete's stored zone.
3. No production route file under `apps/api/src/routes` reads
   `c.req.query("today")` or calls `planDateSchema.safeParse`.
4. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`,
   `bun run check:unused` and `bun run test:coverage` pass.

## Data model and API impact

No schema or migration. The API contract is unchanged except that an invalid
`today` now answers the shared `validation_failed` contract with the default
message instead of a route-specific sentence. The Zod issues point at the same
`today` field.
