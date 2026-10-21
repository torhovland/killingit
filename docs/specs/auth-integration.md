# Spec: Auth0 integration (authentication + authorization)

- **Status:** Accepted (implemented)
- **Date:** 2026-10-17
- **Related:** ADR 0002 (Auth0 Free plan decision)

## Goal

Wire the app to Auth0 so an athlete can sign in (Google/Apple/Facebook for
now; Strava/Garmin when their upstream apps are registered) and so the API can
trust who is calling it. This is the prerequisite for every "my training /
my profile" feature that follows.

## Scope

### In scope

1. **Web (SPA)** — sign-in, sign-out, and attaching a bearer access token to
   API calls. Login requests the API audience + the read scopes our first
   features need.
2. **API** — verify the access token (RS256 JWT) on protected routes and expose
   the authenticated athlete identity (`sub`) to handlers.
3. **Provider-agnostic seam on the API** — the Auth0 logic is isolated behind a
   small interface so a later switch (e.g. Better Auth, or per-user keys) is an
   adapter swap, not a rewrite (ADR 0002 requirement).
4. **Config** — env vars for domain, audience, issuer (already sketched in
   `.env.example`).

### Out of scope (explicitly deferred)

- Strava/Garmin **custom OAuth2 connections** (blocked on upstream app
  registration; Garmin has approval lead time).
- Fetching actual training data from Strava/Garmin.
- Roles / organizations / MFA.
- Linking a past workout or injecting feedback (later features that build on
  the identity).

## Acceptance criteria

1. An unauthenticated request to a protected API route returns **401**.
2. A request with a valid access token (issued by our tenant, correct `aud`,
   correct `iss`, unexpired, RS256) is accepted and the handler can read the
   athlete's `sub`.
3. A request with an **invalid** token (bad signature, wrong `aud`, wrong
   `iss`, expired) returns **401**, never **500**.
4. In the web app, an unauthenticated user sees a sign-in button; after signing
   in, they see a sign-out button and the app attaches the access token to
   protected API calls.
5. The API's auth logic depends only on a `AuthProvider` interface; the Auth0
   specifics live in one adapter module.
6. Unit tests cover token verification (valid + each rejection reason); an
   integration test exercises a protected route end-to-end (401 without a
   token, 200 with a valid token).

## Data-model / API impact

- **Accounts table.** The `athletes` placeholder is still untouched; `sub` is
  linked to an application account in `users` (ADR 0006), which owns the
  `admin`/`member` role.
- **New API route** `GET /api/me` — protected; returns the verified `sub` and
  the account's application role (and later the athlete profile). It also
  provisions the account on first sight.
- **Shared types** — `AthleteIdentity` (`{ sub: string }`) and `CurrentUser`
  (`{ sub, role }`) live in `packages/shared` so web and API share the shapes.

## Technical approach

### API (`apps/api`)

- New module `src/auth/provider.ts`: the `AuthProvider` interface
  `{ verify(token: string): Promise<AthleteIdentity> }`.
- New module `src/auth/auth0.ts`: `Auth0Provider` implementing it, using the
  `jose` package to:
  - fetch + cache the JWKS from `${AUTH0_ISSUER}/.well-known/jwks.json`,
  - verify RS256 signature, `iss` === issuer, `aud` === `${AUTH0_AUDIENCE}`,
    `exp` in the future.
  - No network in tests: JWKS fetch is injected/mocked.
- Hono middleware `requireAuth` that reads `Authorization: Bearer …`, calls the
  provider, and sets `c.set("athlete", identity)` or returns 401.
- `GET /api/me` uses `requireAuth`, then resolves/provisions the account and
  returns `{ sub, role }`.
- Deps: add `jose` (JWKS + JWT verify), already a transitive standard.

### Web (`apps/web`)

- Thin adapter wrapping the Auth0 SPA SDK (`@auth0/auth0-react`), config from
  `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE`.
- `Authorize` with `audience = AUTH0_AUDIENCE` and
  `scope = "openid profile email read:profile read:workouts"`.
- Wrap the app in the provider; add login/logout controls; extend `fetchJson`
  (or a new `fetchAuthed`) to attach `Authorization: Bearer <token>` when a
  user is present.

### Provider-agnostic seam (why this shape)

ADR 0002 requires the LLM and auth integrations to sit behind
provider-agnostic interfaces. The web side mirrors this: the Auth0 SDK is
confined to one adapter so a future `BetterAuthProvider` (or per-user keys)
only replaces that module.

## Testing

- **Unit (API):** `Auth0Provider.verify` — valid token accepted; invalid
  signature / wrong issuer / wrong audience / expired each rejected. JWKS
  mocked (no live network).
- **Unit (web):** the fetch-token-attachment helper (token present/absent).
- **Integration (API):** `GET /api/me` returns 401 without a token and 200 with
  a `sub` + `role` when signed with a test JWKS (the account store is faked).
- Run `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`.

## Implementation notes (deviations from the original plan)

- **Lazy provider creation:** the API creates its `Auth0Provider` on the first
  protected request (not at startup), so importing the app stays
  side-effect-free — mirroring how Sentry is a no-op without a DSN. A missing
  `AUTH0_*` config (or any other infrastructure failure) surfaces as 503, not
  401, so it is not mistaken for a bad token.
- **JWKS fetch is injected** into `Auth0Provider` via jose's `customFetch`
  symbol, so unit tests sign a local key and serve it from a stub `fetch`
  without network access.
- **`requireAuth` accepts a provider or a lazy getter** `() => AuthProvider`,
  so it can resolve the (cached) provider per-request; a provider-construction
  error is treated as an auth failure (401), never 500.

## Risks / open questions

- **`jose` vs hand-rolled verification:** use `jose` (maintained, mature) rather
  than `jsonwebtoken` (stale) or manual JWKS handling.
- **Token refresh in the SPA:** handled by the Auth0 SDK (silent renewal);
  verify it works with the Vite dev proxy origin (`localhost:5173`) and the
  deployed origins already registered on the app.
- **`auth0-react` bundles Auth0 UI; confirm bundle size is acceptable**, or use
  `@auth0/auth0-spa-js` directly behind the adapter for a smaller footprint.

## Definition of done

- Protected route (`/api/me`) behaves per criteria 1–3.
- Web sign-in/out + token attachment works against the real tenant in dev.
- `AuthProvider` interface + Auth0 adapter in place; no Auth0 imports leak
  outside the adapter.
- Typecheck, lint, format, and tests pass.
- ADR 0002 + this spec updated if the approach changed.
