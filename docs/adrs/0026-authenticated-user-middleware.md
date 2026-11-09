# ADR 0026: Resolve the authenticated account in middleware

- **Status:** Accepted
- **Date:** 2026-11-09
- **Deciders:** torhovland
- **Related:** `docs/specs/authenticated-user-middleware.md`,
  `docs/specs/auth-integration.md`, ADR 0006, ADR 0024

## Context

`await deps.users.ensureUser(getAthlete(c).sub)` appeared in 36 route handlers.
Every handler repeated the same provisioning step, each copy could be forgotten
or pointed at the wrong store, and most route factories carried a `UserStore`
dependency only to make that call. Route tests therefore had to fake the store
even when the test was about something else.

The account row is the gate for every per-account table, so a handler that
forgot the call would fail in a way that is hard to see. Provisioning belongs
with the rest of the request identity, not in each handler.

## Decision

- Add `requireUser(store)` to `apps/api/src/auth/middleware.ts`. It runs after
  `requireAuth`, calls `ensureUser(sub)`, and stores the `StoredUser` under
  `user` on the Hono context.
- `getUser(c)` reads the resolved account. Handlers use it instead of calling
  `ensureUser`.
- `requireAdmin()` reads the context user; it no longer takes a store. It still
  returns 403 for a member and must run after `requireUser`.
- `createApp` mounts authentication and account resolution together on
  `/api/*`, behind the same `PUBLIC_API_PATHS` allowlist as ADR 0024. Public
  paths skip both.
- Route factories drop `users` from their dependency interfaces where
  provisioning was the only use.

## Alternatives considered

- **Keep `ensureUser` per handler and add a lint rule.** Rejected: the rule
  would have to recognise the call shape and the right store, and the
  provisioning step would still be repeated 36 times.
- **Resolve the user inside `requireAuth`.** Rejected: it mixes token
  verification with database access, so an auth test would need a user store and
  a JWKS outage would no longer be distinguishable from a database outage.
- **Keep `requireAdmin(store)` provisioning separately.** Rejected: the admin
  path would resolve the same account twice and could disagree with the handler.

## Consequences

- Every protected handler receives the same account from one place, and a new
  route is provisioned without doing anything.
- A provisioning failure is now consistently a 503. Previously handlers that
  caught it did so, while a few let it bubble to the app error handler as 500.
- Route unit tests that drive a factory directly mount `requireUser` beside
  `requireAuth`; tests through `createApp` only inject a fake `UserStore`, as
  before.
- Account resolution adds one indexed store lookup to each protected request;
  this replaces the lookup every handler already made.
