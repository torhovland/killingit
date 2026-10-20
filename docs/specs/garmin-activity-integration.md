# Spec: Garmin activity integration (python-garminconnect, personal use)

- **Status:** Accepted (in progress)
- **Date:** 2026-10-18
- **Related:** ADR 0003 (activity data access) — amended to reverse the
  "do not integrate Garmin" decision.

## Goal

Sync the operator's own **last 31 days of Garmin activities** into the app
using [`python-garminconnect`](https://github.com/cyberjunky/python-garminconnect),
with the operator entering their Garmin **username and password** through the
app. Activities are normalized into a shared `ActivitySummary` shape, and the
sync runs automatically when the operator visits the app while credentials are
present, with progress shown on the main page.

## Why a Python sidecar (and not a backend rewrite)

`python-garminconnect` is a Python library that wraps Garmin Connect's
_internal, unofficial_ HTTP API. The app backend is TypeScript/Bun (Hono +
Drizzle + Auth0 + Sentry), which has no Python runtime and already carries
working, tested auth/data/observability code. A full backend rewrite to Python
to accommodate one library would churn passing code and violate the "small,
reviewable units of work" rule.

Instead, a **small Python sidecar service** wraps `python-garminconnect` and
exposes a minimal HTTP API. The Bun API calls it over HTTP, keeps all Python in
one swappable corner, and normalizes Garmin activities into the shared
`ActivitySummary` shape. This is an adapter seam: a future aggregator (see ADR 0003) replaces the sidecar without touching the API routes.

## Scope

### In scope

1. **Python sidecar** (`services/garmin/`) — a FastAPI service that:
   - authenticates to Garmin Connect with username/password (via
     `python-garminconnect`'s `Garmin().login()`), and
   - returns the last 31 days of activities in a normalized shape.
2. **Credential entry** — a web form (behind Auth0 sign-in) that POSTs the
   Garmin username/password to a protected API endpoint.
3. **Encrypted storage** — credentials encrypted at rest with AES-256-GCM,
   key from `GARMIN_CREDENTIALS_KEY` (env), stored in Postgres. Never
   serialized back to the client.
4. **Sync trigger** — automatically when the operator loads the app while
   credentials exist; progress surfaced on the main page.
5. **Shared types** — a Garmin connection-status schema and (re)use of the
   existing `ActivitySummary` shape.

### Out of scope (explicitly deferred)

- **Multi-user** — single operator only (ADR 0003).
- **Multi-factor Garmin accounts** — MFA-required accounts are a known
  limitation of `python-garminconnect`; documented, not solved.
- **Garmin official developer-program API** — still gated/paused (ADR 0003).
- **Webhooks / real-time sync**, and wiring activities into the **LLM** (a
  separate later spec).
- **Incremental sync** — always pulls the full 31-day window for now.

## Acceptance criteria

1. With valid Garmin credentials, the operator enters them in the web form and
   the app stores them encrypted.
2. Visiting the app (with credentials stored) automatically syncs the last 31
   days of activities and shows progress on the main page.
3. Bad credentials surface as a clear auth error (not a 500); missing
   credentials surface as "not connected".
4. Encrypted credentials are never returned by any API response.
5. Unit tests cover credential encryption, activity mapping, and the sidecar
   client; quality gates (`typecheck`/`lint`/`format`/`test`) pass.

## Data-model / API impact

- **New table** `garmin_connections` (single row, replace on re-entry):
  `username_encrypted`, `password_encrypted`, `updated_at`. Ciphertext columns
  are never serialized to the client.
- **New routes** (`apps/api/src/routes/garmin.ts`, all behind `requireAuth`):
  - `POST /api/garmin/credentials` — store encrypted credentials.
  - `GET  /api/garmin/status` — connected / not connected (no secrets).
  - `GET  /api/garmin/activities` — trigger + return the 31-day sync.
- **New sidecar** `services/garmin/` — `POST /sync` (credentials → normalized
  activities), `POST /authenticate` (validate credentials).
- **New env var** `GARMIN_CREDENTIALS_KEY` (encryption key) + sidecar URL
  config.

## Technical approach

### Sidecar (`services/garmin/`, Python)

- FastAPI + `python-garminconnect`. Endpoints:
  - `POST /sync` — body `{ "username", "password" }` → `{ "activities": [...] }`
    for the last 31 days.
  - `POST /authenticate` — body `{ "username", "password" }` → `{ "ok": true }`
    or auth error (used to validate before storing).
- Kept dependency-minimal and isolated so the Bun app treats it as a
  replaceable adapter.

### API (`apps/api/src/garmin/`)

- `crypto.ts` — AES-256-GCM encrypt/decrypt helpers (key from
  `GARMIN_CREDENTIALS_KEY`).
- `client.ts` — thin HTTP client to the sidecar, injectable for tests.
- `store.ts` — Drizzle upsert/load of the single `garmin_connections` row.
- `routes/garmin.ts` — the three routes above, guarded by `requireAuth`.

### Web (`apps/web/src/GarminSection.tsx`)

- Credential form (username/password) after sign-in; `POST`s to
  `/api/garmin/credentials`.
- On load, if status is connected, fetches `/api/garmin/activities` and renders
  a "Syncing…" state, then the activity list.
- Kept thin; no new SDK dependency beyond the existing fetch helpers.

## Testing

- **Unit (API):** AES encrypt/decrypt round-trip and tamper detection; sidecar
  client mapping + error handling; config-from-env.
- **Unit (Python):** activity normalization + 31-day filtering with a stubbed
  Garmin client (no live network).
- Run `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test` and
  the sidecar's own test suite.

## Risks / open questions

- **Unofficial API / ToS:** `python-garminconnect` uses Garmin Connect's
  internal API, which violates Garmin's terms of service. This is a **chosen**
  risk for personal use, recorded in ADR 0003.
- **Credential sensitivity:** raw credentials are more sensitive than OAuth
  tokens; mitigated by app-level encryption at rest and never serializing them.
- **MFA accounts** are unsupported by the library — surfaced clearly to the
  operator rather than failing silently.
- **Sidecar deployment:** the current deploy pipeline (single Bun container)
  needs a second container/process for the sidecar; deployment wiring is a
  follow-up tracked separately from this data-path work.

## Implementation notes (deviations from the original plan)

- **Token reuse, not repeated logins.** Garmin rate-limits SSO logins hard
  (`429 Too Many Requests`, sometimes keyed on client fingerprint rather than
  IP). The sidecar therefore persists the library's token store per username
  (`GARMIN_TOKENSTORE_DIR`, default a `0700` temp dir). `/authenticate` does the
  one real login; the immediately-following `/sync` resumes from those tokens.
  A first login can still log transient `429`s from individual library
  strategies before a later strategy succeeds.
- **Plain `YYYY-MM-DD` dates.** `get_activities_by_date` rejects ISO
  timestamps; the window is formatted as dates (`_date_window`).
- **Honest error mapping.** The sidecar maps failures to `401` (bad
  credentials), `403` (MFA required, unsupported), `429` (Garmin rate limit),
  and `502` (upstream). The Bun routes pass those through instead of collapsing
  everything to `503`.
- **Type normalization fix:** an activity type object without a `typeKey`
  previously produced a stringified dict; it now yields `"unknown"`.
- **Sidecar tooling is excluded from JS lint/format** (`services/**/.venv`,
  `__pycache__`).

## Definition of done

- Credential entry → encrypted storage → auto-sync → rendered activities works
  end-to-end in dev against the operator's own Garmin account. (Verified against
  the operator's account: 5 activities returned in the 31-day window.)
- All four quality gates pass, plus the sidecar's tests.
- ADR 0003 amended and this spec kept current.
