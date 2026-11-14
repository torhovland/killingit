# Spec: Garmin activity integration (python-garminconnect, personal use)

- **Status:** Accepted (in progress)
- **Date:** 2026-10-18
- **Related:** ADR 0003 (activity data access) — amended to reverse the
  "do not integrate Garmin" decision.

## Goal

Sync the operator's own **last 42 days of Garmin activities** into the app
using [`python-garminconnect`](https://github.com/cyberjunky/python-garminconnect),
with the operator entering their Garmin **username and password** through the
app. Activities are normalized into a shared `ActivitySummary` shape, **with
each activity's recorded timeseries** (GPS location, heart rate, power,
temperature, speed, distance, elevation, cadence) normalized into `samples`,
and the sync runs automatically when the operator visits the app while
credentials are present, with progress shown on the main page.

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
   - returns the last 42 days of activities in a normalized shape, **including
     each activity's timeseries samples**.
2. **Credential entry** — a web form (behind Auth0 sign-in) that POSTs the
   Garmin username/password to a protected, per-account API endpoint.
3. **Encrypted storage** — credentials encrypted at rest with AES-256-GCM,
   key from `GARMIN_CREDENTIALS_KEY` (env), stored in Postgres per user. Never
   serialized back to the client.
4. **Sync trigger** — automatically when the operator loads the app while
   credentials exist; progress surfaced on the main page.
5. **Shared types** — a Garmin connection-status schema, the existing
   `ActivitySummary` shape, and a `samples` timeseries on each synced activity
   (shared `Activity` type).
6. **Workout timeseries** — per-activity detail metrics from Garmin are
   normalized per sample into timestamp + location, heart rate, power,
   temperature, speed, distance, elevation, and cadence where recorded. Each
   activity also stores its recorded average and maximum speed. The app shows
   pace for running, walking, hiking, swimming and rowing, and speed for
   cycling and other sports.
7. **Strength exercise sets** — strength activities also carry the recorded
   exercises, repetitions, weight and rest intervals. See
   `docs/specs/garmin-strength-exercise-sets.md`.
8. **Daily health metrics** — a per-day backfill of sleep, HRV, resting heart
   rate, stress, Body Battery, training readiness, VO2max and related values,
   stored as dated metrics with per-day watermarks. See
   `docs/specs/garmin-daily-health-metrics.md`.

### Out of scope (explicitly deferred)

- **Multi-factor Garmin accounts** — MFA-required accounts are a known
  limitation of `python-garminconnect`; documented, not solved.
- **Garmin official developer-program API** — still gated/paused (ADR 0003).
- **Webhooks / real-time sync.** (Wiring activities into the LLM is now covered
  by `docs/specs/openrouter-llm-integration.md`.)
- **Incremental sync** — always pulls the full 42-day window for now.
- **Timeseries persistence and charts** — samples travel with the sync
  response, and the activity feed carries a bounded, downsampled preview for
  the Activities page; storing the full timeseries and serving chart data is
  still a follow-up.

## Acceptance criteria

1. With valid Garmin credentials, the operator enters them in the web form and
   the app stores them encrypted.
2. Visiting the app (with credentials stored) automatically syncs the last 42
   days of activities and shows progress on the main page.
3. Bad credentials surface as a clear auth error (not a 500); missing
   credentials surface as "not connected".
4. Encrypted credentials are never returned by any API response.
5. Each synced activity carries a `samples` timeseries normalized from Garmin's
   activity details, with absent channels omitted per sample and one bad detail
   fetch not failing the whole sync. The stored summary also carries average and
   normalized power when the activity recorded power, so training-load scoring
   does not need the raw timeseries. It carries the recorded average heart rate
   and average and maximum speed when Garmin supplies them, and derives the
   average speed from distance and duration when Garmin leaves it at zero.
6. `startDate` is the activity's UTC start (`startTimeGMT`), not the naive
   wall-clock `startTimeLocal`, so the UI can render it in the athlete's chosen
   time zone.
7. Unit tests cover credential encryption, activity/sample mapping, and the
   sidecar client; quality gates (`typecheck`/`lint`/`format`/`test`) pass.

## Data-model / API impact

- **Table** `garmin_connections` (one row per user, upsert on `user_id`):
  `user_id`, `username_encrypted`, `password_encrypted`, `updated_at`.
  Ciphertext columns are never serialized to the client.
- **Routes** (`apps/api/src/routes/garmin.ts`, all behind `requireAuth` and
  scoped to the signed-in account):
  - `POST /api/garmin/credentials` — store encrypted credentials.
  - `GET  /api/garmin/status` — connected / not connected (no secrets).
  - `GET  /api/garmin/activities` — trigger + return the 42-day sync.
  - `GET  /api/coaching/activities/cached` — return the last successfully
    synced activity feed without contacting Garmin, so the dashboard can show
    existing cards while the live sync runs.
- **New sidecar** `services/garmin/` — `POST /sync` (credentials → normalized
  activities, each with a normalized `samples` timeseries),
  `POST /daily` (credentials + a date → one day's normalized health metrics),
  `POST /authenticate` (validate credentials).
- **Shared type** — `Activity` extends `ActivitySummary` with
  `samples: ActivitySample[]`; no database change.
- **New env var** `GARMIN_CREDENTIALS_KEY` (encryption key) + sidecar URL
  config.

## Technical approach

### Sidecar (`services/garmin/`, Python)

- FastAPI + `python-garminconnect`. Endpoints:
  - `POST /sync` — body `{ "username", "password" }` → `{ "activities": [...] }`
    for the last 42 days. For each activity it also calls
    `get_activity_details()` and resolves the positional
    `activityDetailMetrics` with the library's
    `parse_activity_detail_metrics()` into normalized `samples`. A failed
    detail fetch logs and yields `samples: []` for that activity; a Garmin
    rate-limit still fails the sync with `429`.
  - `POST /authenticate` — body `{ "username", "password" }` → `{ "ok": true }`
    or auth error (used to validate before storing).
- Kept dependency-minimal and isolated so the Bun app treats it as a
  replaceable adapter.

### API (`apps/api/src/garmin/`)

- `crypto.ts` — AES-256-GCM encrypt/decrypt helpers (key from
  `GARMIN_CREDENTIALS_KEY`).
- `client.ts` — thin HTTP client to the sidecar, injectable for tests.
- `store.ts` — Drizzle upsert/load of the user's `garmin_connections` row.
- `routes/garmin.ts` — the three routes above, guarded by `requireAuth`.

### Web (`apps/web/src/`)

- `GarminSection.tsx` — credential form (username/password) after sign-in;
  `POST`s to `/api/garmin/credentials`. When connected it shows the connected
  state and an "Update Garmin credentials" action that reopens the form; saving
  replaces that user's stored credentials. Activity loading lives in the
  coaching dashboard.
- `CoachDashboard.tsx` / `ActivityCard.tsx` — on load, if status is connected,
  fetches `/api/coaching/activities` (which syncs Garmin and optionally analyses
  the activities) and renders a "Syncing…" state, then the activity list. The
  last successful feed is cached in browser storage per account, so existing
  cards render immediately on reload while the sync and analyses refresh.
- Kept thin; no new SDK dependency beyond the existing fetch helpers.

## Testing

- **Unit (API):** AES encrypt/decrypt round-trip and tamper detection; sidecar
  client mapping + error handling; config-from-env.
- **Unit (Python):** activity and sample normalization + 42-day filtering with
  a stubbed Garmin client (no live network).
- Run `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test` and
  `bun run check:garmin` (the sidecar's pytest, ruff and mypy gates).

## Risks / open questions

- **Unofficial API / ToS:** `python-garminconnect` uses Garmin Connect's
  internal API, which violates Garmin's terms of service. This is a **chosen**
  risk for personal use, recorded in ADR 0003.
- **Credential sensitivity:** raw credentials are more sensitive than OAuth
  tokens; mitigated by app-level encryption at rest and never serializing them.
- **MFA accounts** are unsupported by the library — surfaced clearly to the
  operator rather than failing silently.
- **Sidecar deployment:** the deploy pipeline builds the sidecar image and
  runs it as a private Cloud Run service (`killingit-garmin-test` /
  `killingit-garmin`). The API authenticates with an OIDC identity token
  (`GARMIN_SIDECAR_AUDIENCE`) and only its runtime service account holds
  `roles/run.invoker`.
- **Payload size:** full-resolution timeseries for a month of activities can be
  large. The sync response is the only consumer today; persistence and
  downsampling are deferred (see out of scope). Detail fetches add one Garmin
  request per activity, so the existing rate-limit handling covers them.

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
  and `502` (upstream). The Bun routes pass `403`, `429` and `502` through
  instead of collapsing everything to `503`. A sidecar `401` is the athlete's
  stored credential, not the API session, so it is translated to `409`
  `garmin_auth_failed` (see `docs/specs/third-party-credential-failures.md`).
- **Type normalization fix:** an activity type object without a `typeKey`
  previously produced a stringified dict; it now yields `"unknown"`.
- **Sidecar tooling is excluded from JS lint/format** (`services/**/.venv`,
  `__pycache__`).
- **Sidecar responses are validated and bounded.** Every sidecar request
  carries an `AbortSignal.timeout` (kept under the API's 255-second idle
  timeout), so a hung sidecar fails with a typed `GarminSidecarError` instead
  of holding the API request open. The `/sync` activities are parsed with the
  shared `activitySchema` array, and a malformed payload raises
  `GarminSidecarError` before anything reaches the stored feed.
- **Malformed sync payloads cannot blank the page.** The web validates the
  `{ activities }` response against the shared `activitiesResponseSchema`
  before rendering; a shape error becomes an inline Garmin error. `samples`
  defaults to `[]` so a pre-timeseries sidecar still parses. Independently, a
  top-level React `ErrorBoundary` renders a recovery page ("Something went
  wrong", retry/reload) for any uncaught render error and reports it to Sentry
  through React 19's `onCaughtError` hook.
- **Cadence is resolved per activity type.** Garmin exposes
  `directFractionalCadence` (a 0..1 remainder), the per-leg `directCadence`,
  the running total `directDoubleCadence`, `directBikeCadence`, and
  `directStrokeCadence`. Reading the fractional channel alone made running
  imports report 0 or 1. The sidecar now prefers the running total, otherwise
  doubles the per-leg value for runs, keeps pedalling rpm for rides, and keeps
  the stroke rate for rows and swims.
- **Speed is canonical; pace is the display unit.** Garmin records speed in
  m/s, even for sports where Connect shows pace. The summary keeps
  `averageSpeed`/`maxSpeed` in m/s, and the UI and prompts convert to pace for
  runs, walks, hikes, swims and rows. Swimming uses a 100 m interval and rowing
  a 500 m split; other pace sports use a kilometre. When Garmin's summary leaves
  `averageSpeed` at zero (indoor rowing is an example), the sidecar derives it
  from distance and moving time. A missing summary speed is also derived at
  read time, so activities stored before this change still show pace. When
  Garmin recorded neither distance nor speed, the recorded-samples view says so
  instead of showing a zero-only distance column; pace cannot be derived from
  heart rate or stroke rate alone.
- **Sample preview.** The feed keeps the full timeseries server-side and adds
  an evenly spaced, bounded `samples` preview (`MAX_PREVIEW_SAMPLES`) to each
  `AnalyzedActivity`. The Activities page shows it in a collapsible table so the
  athlete can inspect what was recorded without a second Garmin request.
- **Every synced activity is kept.** A sync extends the stored feed instead of
  replacing it: activities still inside Garmin's 42-day window get their latest
  summary and preview, and activities that have fallen outside it keep their
  stored analysis and feedback. The analysis cap only limits how many of the
  newest activities one run sends to the model; Calendar, Activities, and the
  Fitness chart read the full history.
- **Deleting an imported activity is local.** Garmin Connect remains the source
  of truth, so a deletion stores a per-user tombstone and filters the activity
  out of the feed and plan. See `docs/specs/activity-deletion.md`.
- **Timeseries from activity details.** Each activity triggers
  `get_activity_details()`, whose positional `activityDetailMetrics` are
  resolved through the library's `parse_activity_detail_metrics()` and mapped
  to a normalized `samples` list (epoch milliseconds → ISO-8601 UTC; absent or
  non-numeric channels omitted). `sumDistance` is preferred over
  `directDistance` for cumulative distance. A failed detail fetch yields
  `samples: []` for that activity rather than failing the sync.
- **Laps from activity splits.** Each activity also triggers
  `get_activity_splits()`, whose `lapDTOs` are mapped to a normalized `laps`
  list with each lap's index, type, start time, distance, moving and elapsed
  time, average and maximum power, average and maximum heart rate, average
  speed, cadence and elevation gain. Channel names vary by device, so each is
  read through documented aliases and omitted when absent; a lap with nothing
  but its index is dropped, a single-lap result is treated as no laps, and the
  list is capped at 100 laps. A failed splits
  fetch yields no `laps` for that activity rather than failing the sync. The
  activity analysis lists every lap; the plan and reply prompts get a compact
  power/HR range. The Activities page shows the laps in a collapsible table. See
  `docs/specs/garmin-activity-laps.md`.

## Other sport-specific fields worth considering

Garmin's activity summary exposes more than the current normalized shape. The
following are the highest-value additions, roughly in priority order:

- **All sports:** maximum heart rate, time in heart-rate and power
  zones, aerobic/anaerobic training effect, Garmin's activity training load,
  respiration rate, calories, and min/max temperature and elevation.
- **Running:** grade-adjusted speed/pace (`avgGradeAdjustedSpeed`), stride
  length, ground contact time and balance, vertical oscillation and ratio,
  fastest 1 km/1 mile splits, and running power.
- **Cycling:** Garmin's normalized power, average/max power, intensity factor
  and training stress score, maximum 20-minute power, and the power-curve bests
  (`maxAvgPower_*`). The app already computes power from samples, so these are
  mainly cross-checks and a fallback when the raw samples are missing.
- **Swimming:** stroke cadence, SWOLF, stroke distance, active lengths, pool
  length, and stroke count.
- **Rowing:** stroke cadence, total strokes, distance per stroke, and the
  500 m split pace.
- **Strength:** summary total/active sets and total reps. The app already reads
  the detailed exercise sets.

The coach can act on recovery and intensity fields (heart rate, training
effect, load, running dynamics) more directly than on device-specific extras,
so those should come before niche fields such as diving or snow-sport metrics.

## Definition of done

- Credential entry → encrypted storage → auto-sync → rendered activities works
  end-to-end in dev against the operator's own Garmin account. (Verified against
  the operator's account: 5 activities returned in the 42-day window.)
- Every synced activity carries its normalized timeseries `samples`.
- All four quality gates pass, plus the sidecar's tests.
- ADR 0003 amended and this spec kept current.
