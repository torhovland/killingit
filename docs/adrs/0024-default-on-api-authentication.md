# ADR 0024: Authenticate every `/api` route by default

- **Status:** Accepted
- **Date:** 2026-11-08
- **Deciders:** torhovland
- **Related:** `docs/specs/auth-integration.md`, ADR 0002, ADR 0006

## Context

Authentication was opt-in per route prefix: `createApp` registered
`requireAuth` for `/me/*`, `/questions/*`, `/garmin/*`, `/llm/*`,
`/weather/*`, `/coaching/*`, `/fitness/*`, `/calendar/*`, `/diet/*`, and
`/admin/*`. The plan route (`/coaching/plan`) had no middleware of its own; it
was protected only because `/coaching/*` happened to cover it. Changing the
route path, reordering registration, or mounting an alias under another prefix
would silently expose plan generation. More generally, every new route started
out public and stayed public if its prefix was not also registered, which is
the wrong default for per-account data.

## Decision

- Register `requireAuth` once on `/api/*` in `createApp`, before the sub-app
  routes are mounted.
- Allow only the paths listed in `PUBLIC_API_PATHS` (`/api/health` and
  `/api/greet`) through unauthenticated. The list is exact-match: anything else
  under `/api`, including an unknown path, is rejected with 401 before routing.
- Keep `requireAdmin` as an additional middleware on `/admin/*`; it runs after
  the global `requireAuth`, which is where the athlete identity comes from.
- Test one sample route from every protected family, the plan read and generate
  routes explicitly, and an unregistered `/api` path, so a route that moves or
  a new mount cannot become public unnoticed.

## Alternatives considered

- **Register `requireAuth` explicitly on `/coaching/plan/*` as well.** Rejected:
  `/coaching/*` still matches the same requests, so the token would be verified
  twice. Narrowing the coaching prefix away from `/coaching/plan` would make the
  shared URL space depend on registration order, which is the coupling being
  removed.
- **Keep opt-in auth and add the plan prefix only.** Rejected: it fixes this one
  route but leaves the insecure default in place for the next route.
- **Authenticate in each route factory.** Rejected: it spreads the same
  middleware across every factory and still allows a factory to forget it.

## Consequences

- A newly added `/api` route is protected without any middleware declaration.
  Making it public requires an explicit, reviewed entry in `PUBLIC_API_PATHS`.
- Unauthenticated requests to unregistered `/api` paths return 401 rather than
  404, which also avoids revealing which routes exist.
- Route-level and factory tests still mount their own `requireAuth`; they test
  a route in isolation and are unaffected.
- The public surface is two exact paths, which is small enough to audit in one
  place.
