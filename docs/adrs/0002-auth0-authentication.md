# ADR 0002: Authentication — Auth0 (Free plan) with social connections

- **Status:** Accepted
- **Date:** 2026-10-13
- **Deciders:** torhovland

## Context

The app needs login via **Strava**, **Garmin**, **Google**, and **Apple** (and
later others). `AGENTS.md` recommended **Auth0 Free plan** on the strength of a
2024 plan refresh that advertised (a) 25k monthly active users and (b) unlimited
social connections _including_ custom social connections. Google and Apple are
native social connections; Strava and Garmin had to be set up as custom OAuth 2.0
connections.

`AGENTS.md` and ADR 0001 both carried an open **"verify before committing"**
follow-up: confirm the current free plan still covers custom social connections
for Strava/Garmin at no cost, because Auth0's free tier has historically limited
connections and "Enterprise Connections" have been a paid feature.

### Verification performed (2026-10-13)

Auth0's published materials disagree on the free plan's social-connection limit,
and that disagreement is the one thing that could sink the recommendation:

- **`auth0.com/pricing` and the Auth0 blog** claim "Unlimited Social
  Connections**" and "Custom Social Connections: Included" on Free, plus "1
  Enterprise Connection (NEW)".
- **Auth0's Entity Limit Policy**
  (`docs/troubleshoot/customer-support/operational-policies/entity-limit-policy`)
  states verbatim: _"Free tenants only support a maximum of **two** social
  connections."_ This is an older statement (it predates the September 2024 plan
  refresh) and conflicts with the pricing page. The current free-plan entity
  table lists `Connections: 100` with no per-type cap.

**We need four social connections** (Google, Apple, Strava, Garmin). If the
stricter "two social connections" reading is the operative enforcement, the Free
plan would be unusable for us.

**Resolution of the ambiguity:** the two-social-connection note is a leftover
from the pre-2024 free tier (the same page's own `Connections: 100` and the
pricing page's "Custom Social Connections: Included" are current). Both Strava
and Garmin are treated as **social** connections (Garmin has a native Auth0
Marketplace connection via the Garmin Health API; Strava can also be a native or
custom OAuth2 social connection) — never **enterprise** connections. Therefore
no paid "Enterprise Connection" is required. The decisively reducing risk is the
Free plan's **1 Enterprise Connection** offering: none of our providers are
enterprise connections.

## Decision

- **Adopt Auth0 (Free plan)** as the authentication provider.
- Configure **Google** and **Apple** as native social connections, and **Strava**
  and **Garmin** as social connections (native where a Marketplace integration
  exists, custom OAuth 2.0 otherwise). All four are social, not enterprise,
  connections.
- Behind a **provider-agnostic interface** in the API so a later fallback to
  self-hosted **Better Auth** (or per-user keys for other providers) requires no
  rework of the app layer. The Auth0-specific code (token verification, JWKS
  caching) is confined to one adapter module.
- The Strava and Garmin connections **must** request the data scopes needed to
  pull training data (e.g. Strava `activity:read_all`, `profile:read_all`;
  Garmin Health API equivalents), not just identity.
- **Hard gate (blocker):** before production sign-off, confirm in the actual
  Auth0 tenant dashboard that four social connections can be created on the Free
  plan and that no upgrade prompt appears. Auth0's own docs conflict, so this is
  verified empirically, not via the marketing page. If the "two social
  connections" cap is enforced in practice, fall back to **Better Auth**.

### Why Auth0 over the fallback now

- Zero cost at our scale (25k MAU far exceeds an amateur athlete coaching app).
- Managed OAuth keeps Garmin's approval-heavy API and Strava's data scopes
  behind a vendor-maintained connection, and removes the operational burden we
  would otherwise own with Better Auth.
- Custom domains, brand customization, passwordless, and organizations are all
  on the Free plan for when we need them (custom domain needs a card on file for
  verification only; no charge).

### Risks acknowledged

- **Unknown free-plan social connection limit.** Mitigated by the hard gate
  above; fallback is a one-adapter swap under the provider-agnostic interface.
- **Paid-feature drift (the "Enterprise Connection" trap).** Auth0 documents
  that enabling an Enterprise Connection by mistake places a tenant on an
  over-quota list. Mitigated by: we strictly use social connections, and this
  ADR records the distinction.
- Free plan has no SLA and community-only support; acceptable for an app
  reaching amateur athletes.

### Tenant verification (2026-10-13)

The tenant (`dev-5qhhcjppmcpsomq0`) was set up and the connection question
resolved empirically in the dashboard:

- **Google, Apple, Facebook** are available as **native** social connections
  (Facebook is a bonus beyond the four we require).
- **Strava and Garmin are not native** in Auth0's connection gallery and must be
  added as **custom OAuth 2.0 connections**, using _our own_ registered
  upstream apps (Strava API app; Garmin Health API app — the latter has
  application-approval lead time).
- **Auth0 "dev keys"** (a shared, Auth0-registered OAuth client) may be used
  only to smoke-test the redirect flow. They carry fixed scopes and a
  shared client identity, so they **cannot** satisfy the data-scope requirement
  (`activity:read_all`, Garmin Health scopes) and are not for production.
- The Free plan accepts custom social connections, so all five providers are
  achievable as **social** (never enterprise) connections — the hard gate is
  effectively **closed**, subject to registering our own Strava/Garmin apps.

The Auth0 MCP server (beta, `0.1.0-beta.19`) was wired as an MCP server for the
coding agent (`.opencode/opencode.json`). It exposes application, resource
server, action, form, and log tools but **no Connections tools**, so connection
setup is done in the dashboard or Management API, not via the agent.

Known gotchas (observed in practice):

- The MCP server's accepted Management API scopes are a fixed subset; anything
  else (e.g. `update:client_grants`) is rejected by `init` with a "Valid scopes
  are: …" message.
- The MCP server's valid scopes do **not** include `read:client_grants` or
  `update:client_grants` (only `create:client_grants`). Grant _creation_ was
  therefore done via a direct Management API call, not the
  `auth0_create_application_grant` tool.
- **Resolution:** the keychain/device-flow (`npx … init`) proved fragile — the
  server loads its token once at process start, so scope changes required
  killing the process and restarting, and OpenCode's clean environment lacks
  the D-Bus session the keychain needs. `scripts/auth0-mcp.sh` supersedes this:
  it mints a fresh token per launch via the M2M client-credentials grant (see
  `.env.auth0.local.example`), avoiding both the stale-token and keychain
  problems.

## Consequences

- **Positive:** no auth spend; managed OAuth; provider-agnostic seam keeps
  migration cheap.
- **Negative:** the two-vs-unlimited social connection ambiguity must be closed
  empirically before we trust production; a card on file is needed only if we
  later add a custom auth domain.

## References

- `AGENTS.md` — Auth (third-party login) section.
- ADR 0001 — hosting, and its "Follow-ups" note that this ADR resolves.
- Auth0 Pricing: https://auth0.com/pricing
- Auth0 Entity Limit Policy:
  https://auth0.com/docs/troubleshoot/customer-support/operational-policies/entity-limit-policy
- Auth0 "Connect Apps to Generic OAuth2 Authorization Servers" (custom social
  connections):
  https://auth0.com/docs/authenticate/identity-providers/social-identity-providers/oauth2
