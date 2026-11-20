# Web token renewal retry

- **Status:** Accepted (implemented)
- **Date:** 2026-11-20
- **Related:** Sentry `KILLINGIT-WEB-P`, `docs/specs/auth-integration.md`,
  ADR 0002 (Auth0).

## Goal

A silent token renewal that loses a race for the SDK's renewal lock must not
surface as a bare `Timeout` error on the page. The athlete keeps their session,
the request is retried once, and only a second timeout becomes a failure — with
a message that says what to do.

## Background

`@auth0/auth0-spa-js` renews an access token under a cross-tab lock
(`auth0.lock.getTokenSilently.<clientId>.<audience>`): the Web Locks API where
available, `browser-tabs-lock` otherwise. `runWithLock` gives the wait a fixed
budget of 5 s and then throws `TimeoutError` with the message `Timeout`.

The lock is held while the SDK performs the refresh-token exchange (or the
silent-iframe fallback), so a legitimate renewal can hold it for longer than 5 s:

- a slow or stalled mobile connection during the `POST /oauth/token` exchange;
- another tab of the app that is renewing at the same moment, including a tab
  the browser has frozen in the background, which keeps the lock but stops
  making progress;
- the app's own `cacheMode: "off"` renewal after a `401`, racing the cached
  renewal of another request.

The app surfaced that error unchanged: `reportError` returned
`error.message`, so the coaching dashboard showed `Error: Timeout` and sent a
Sentry event titled `Error: Timeout` with no hint about what timed out. The
session was never actually invalid; the very next token request succeeded.

## Scope

Only the web adapter's token call (`apps/web/src/auth/auth0.ts` and the helper
module beside it). The API, the Auth0 tenant configuration, the token cache and
the `SessionExpiredError` flow are unchanged.

## Behaviour

- A token request that fails with the SDK's `TimeoutError` is retried once,
  unchanged (same audience, scope and `cacheMode`). By then the competing
  renewal has populated the token cache or released the lock, so the retry
  normally resolves immediately.
- Any other failure — network error, Auth0 outage, a session that can never
  renew — is not retried and propagates as before. The unrecoverable-session
  errors still clear the cached session and throw `SessionExpiredError`.
- When the retry also times out, the adapter throws `TokenRenewalTimeoutError`
  ("Renewing your session timed out. Check your connection and try again.")
  with the SDK error as its cause. It is a transient failure: the session is
  kept, the athlete is not signed out, and the page shows the message through
  the usual `reportError` path, which still reports the event to Sentry so a
  renewal that is persistently slow stays visible.

## Acceptance criteria

- `getToken` retries exactly once when the provider throws `TimeoutError` and
  returns the retried token.
- `getToken` throws `TokenRenewalTimeoutError` (not the SDK error) when both
  attempts time out, and does not sign the athlete out.
- A non-timeout failure is attempted once and propagates unchanged; a
  `MissingRefreshTokenError` still yields `SessionExpiredError` and a local
  logout.
- `apps/web/src/auth/tokenRetry.test.ts` covers success, retry, both-timeout,
  non-timeout and retry-fails-differently cases.
- `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`,
  `bun run check:unused` and `bun run test:coverage` pass.

## Data model and API impact

None. No route, schema, database or prompt change; the token wire contract is
untouched.
