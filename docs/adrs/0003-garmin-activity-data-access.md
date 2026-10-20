# ADR 0003: Activity data access — Garmin via `python-garminconnect` (personal use)

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** torhovland

## Context

The app pulls amateur athletes' training data and feeds it to an LLM to produce
coaching. The first data source is **Garmin Connect**, for single-operator
personal use.

Garmin's official data path is closed to small projects:

- The **Garmin Connect Developer Program** is business-only, application +
  review, and some metrics require license fees or minimum device-order
  quantities.
- **New API access is paused:** Garmin removed the new-applicant form in 2026
  while it "completes updates," with no announced reopening date. The only
  current inroads are via existing holders (typically aggregators).

**Strava** was evaluated as a first source and dropped: its 2026 developer
program is approval-gated, subscription-gated, and its API policy (§5.3)
prohibits using Strava data "in connection with the development, training,
evaluation, or operation of any AI Application," including ingestion into a
context window — which is the core product. Aggregators (Terra/ROOK/Junction)
are not adopted now: all have a $300–$400/mo entry floor with no real free
tier, unjustifiable pre-revenue.

## Decision

- **Integrate Garmin through [`python-garminconnect`](https://github.com/cyberjunky/python-garminconnect)**
  (a reverse-engineered wrapper around Garmin Connect's _internal, unofficial_
  HTTP API), exposed as a **Python sidecar service** (`services/garmin/`) that
  the Bun backend calls over HTTP.
- **The operator enters their Garmin username/password** through the app.
  Credentials are **encrypted at rest** (AES-256-GCM, key from
  `GARMIN_CREDENTIALS_KEY`) and never serialized to the client.
- **Single operator only** for now; no multi-user credential storage.
- **Do not adopt an aggregator yet.** Revisit when there is paying demand; an
  aggregator is the natural unlock for first-class Garmin and multi-user
  support later, replacing the sidecar behind the same adapter seam.

### Why a Python sidecar rather than rewriting the backend

`python-garminconnect` is Python; the backend is TypeScript on Bun (Hono +
Drizzle + Auth0 + Sentry), already implemented and tested. Rewriting the
backend to accommodate one library would churn passing code for no benefit
elsewhere. A small sidecar keeps all Python in one replaceable corner: if
Garmin's official program reopens or an aggregator is adopted, the sidecar is
swapped without touching the API routes.

### Why credentials rather than OAuth

Garmin's unofficial API is username/password based (its SSO is not a supported
public OAuth provider for third-party apps). Handling raw credentials is
therefore unavoidable with this approach; the mitigation is encryption at rest
and strict non-serialization.

### Accepted risks

- **Unofficial API / ToS:** `python-garminconnect` uses Garmin Connect's internal
  API, against Garmin's terms of service. This is a **chosen** risk for personal
  use, to be re-evaluated before any multi-user launch or public distribution.
- **Credential sensitivity:** raw credentials are more sensitive than OAuth
  tokens; mitigated by app-level encryption at rest and never returning them.
- **Rate limiting:** Garmin throttles repeated SSO logins (`429`). The sidecar
  caches the library's session tokens per username so it logs in once and
  reuses the session.
- **MFA-required accounts** are unsupported by the library and are reported as
  `403` rather than failing silently.

## Consequences

- **Positive:** Garmin activity sync works today with zero approval and zero
  added cost; data flows into the app behind a provider-agnostic seam.
- **Negative / limits:** single-operator only; unofficially supported; MFA
  accounts unsupported; the sidecar is a second process to deploy and operate.
- **Follow-ups:** wire the sidecar into the deploy pipeline; re-audit the ToS
  posture before any multi-user launch; revisit an aggregator when demand
  justifies it.

## References

- `AGENTS.md` — product vision, stack, weather/daylight, LLM.
- `docs/specs/garmin-activity-integration.md` — implementation spec.
- Garmin Connect Developer Program FAQ:
  https://developer.garmin.com/gc-developer-program/program-faq/
- `python-garminconnect`: https://github.com/cyberjunky/python-garminconnect
- Strava API policy §5.3 (why Strava was dropped):
  https://www.strava.com/legal/api_policy
