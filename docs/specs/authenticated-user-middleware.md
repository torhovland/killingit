# Authenticated user resolution

Issue: #160.

## Goal

Resolve the account behind the authenticated subject once, in middleware, and
hand every protected handler the same `StoredUser`. No route should provision
the account itself.

## Scope

- `requireUser(store)` in `apps/api/src/auth/middleware.ts` runs after
  `requireAuth`, calls `UserStore.ensureUser(sub)`, and stores the result under
  `user` on the Hono context.
- `getUser(c)` reads it. `requireAdmin()` checks its role and no longer takes a
  store of its own.
- `createApp` mounts the authentication and user-resolution middleware
  together on `/api/*`, so the allowlisted `PUBLIC_API_PATHS` skip both, and
  every other route, including an unknown one, has a resolved account before a
  handler runs. The same chain first checks the API contract version, which is
  also skipped for the public paths; see `docs/specs/api-versioning.md`.
- The Garmin, LLM and question route factories drop their now-unused `users`
  dependency; the coaching dependency bundle drops it too. `UserStore` stays on
  the shared context for the middleware, `/api/me`, admin checks and plan
  generation.
- `GET /api/me` returns the context user; `PATCH /api/me` updates its settings
  without a second provisioning call.

## Rules

- Handlers read `getUser(c)` and never call `ensureUser`. Provisioning lives in
  exactly one place.
- A missing context user is a wiring bug, not a runtime case: the middleware
  always runs first for protected routes.
- Failure to resolve the account is an infrastructure failure, not a denial:
  log it and return 503. Role checks still return 403 for a member.
- Route tests stay database-free by injecting a fake `UserStore` through
  `createApp`, or by mounting `requireUser` beside `requireAuth` when they drive
  a factory directly.

## Acceptance criteria

- No route handler calls `UserStore.ensureUser` directly.
- `401` without a token, `403` for a non-admin, and `503` when the account store
  fails are covered by tests.
- A public path still works when the account store is down.
