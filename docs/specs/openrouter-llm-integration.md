# Spec: OpenRouter LLM integration and activity coach analysis

- **Status:** Accepted (implemented)
- **Date:** 2026-10-20
- **Related:** ADR 0004 (OpenRouter), ADR 0003 / Garmin spec (activity data).

## Goal

Give the operator a configuration surface for OpenRouter (API key + model
choice), then use that model to analyse each of the latest Garmin activities —
including their timeseries — and show the latest activities with coach analysis
on the main page.

## Scope

### In scope

1. **Configuration UI** (behind Auth0 sign-in):
   - OpenRouter API key input (validated before saving).
   - Model picker populated from OpenRouter's model catalog (with manual entry
     as a fallback if the catalog cannot be loaded).
   - A compact "OpenRouter connected · <model>" state with a change action.
2. **Encrypted storage** of the API key (AES-256-GCM, key from
   `LLM_CREDENTIALS_KEY`) plus the selected model in a single-row
   `llm_settings` table. The key is never returned by any endpoint.
3. **Provider-agnostic LLM seam** (`LlmProvider`) implemented by OpenRouter:
   `listModels`, `validateKey`, `complete`.
4. **Coach analysis for activities**:
   - Sync the last 31 days of Garmin activities.
   - Analyse the latest activities (default 10, max 20), each with a prompt
     containing the summary, the current week's planned sessions, aggregate
     channel stats, and a downsampled timeseries (≤90 rows; first/last
     preserved).
   - Ask the coach to match each activity to the planned session for its date,
     today's session, or another session that week, treating the device's
     activity type as unreliable (erratic heart rate may indicate a planned
     strength session).
   - Return activity data with the analysis (or a per-activity error) for the
     main page.
5. **Analysis cache** in `activity_analyses` keyed by activity id, invalidated
   when the selected model changes, with `?refresh=true` to force regeneration.
6. **Main page** showing the latest activities with their analysis, model, and
   generation time; "Sync & re-analyze" forces a fresh pass. The last
   successful feed is cached per account in browser storage so existing cards
   are visible as soon as the page loads, before the new sync finishes.

### Out of scope (deferred)

- Per-user keys and multiple providers (ADR 0004 follow-up).
- Streaming responses / live "thinking" progress.
- Cost/token accounting and budgets.
- Persisting full Garmin activities; the page still re-syncs from Garmin.
- Chat-style coaching and pre-workout steering.
- Weather/daylight in prompts.

## Acceptance criteria

1. With `LLM_CREDENTIALS_KEY` set, the operator can save a valid OpenRouter key
   and a model; an invalid key returns 401, an unknown model returns 400, and
   the stored key is never serialized.
2. The model picker lists OpenRouter models; manual model entry works if the
   catalog request fails.
3. With Garmin connected and OpenRouter configured, visiting the page syncs
   Garmin activities, analyses the latest ones, and renders each activity with
   its coach analysis. Before OpenRouter is configured, activities still render
   without analyses.
4. The prompt includes recorded timeseries data, and the analysis references
   concrete values from it.
5. Cached analyses are reused on revisit; changing the model or forcing a
   refresh regenerates them.
6. A single failed analysis does not blank the page; the card shows the error.
7. Unit tests cover the prompt/timeseries compression, the OpenRouter client,
   the shared schemas, and the activity card; all four quality gates pass.

## Data-model / API impact

- **New table `llm_settings`** (single row at fixed id 1, replace on save):
  `provider` (default `openrouter`), `api_key_encrypted`, `model`, `updated_at`.
- **New table `activity_analyses`**: `activity_id` (unique, `bigint` — Garmin
  ids exceed 32-bit integers), `model`, `prompt_version`, `analysis`,
  `created_at`, `updated_at`. A cached analysis is reused only when both the
  model and prompt version match.
- **New table `activity_feed_cache`**: one row per user with the last
  successfully synced `{ model, activities }` feed. It is replaced after every
  successful sync and lets the dashboard show existing cards on page load
  without waiting for Garmin. Also cached in browser storage per account for a
  synchronous first paint.
- **New env var** `LLM_CREDENTIALS_KEY` (encryption key) and optional
  `OPENROUTER_API_URL` (base-URL override).
- **New routes** (all behind `requireAuth`):
  - `GET  /api/llm/settings` — `{ configured, provider, model }`, no key.
  - `PUT  /api/llm/settings` — `{ apiKey?, model }`; validates and stores.
  - `GET  /api/llm/models` — normalized OpenRouter catalog.
  - `GET  /api/coaching/activities`, `?limit=10&refresh=false` — sync Garmin,
    analyse the latest activities, return activities + analyses. Before
    OpenRouter is configured it returns the activities with `model: null` and no
    analyses, so the Garmin sync remains useful.
  - `GET  /api/coaching/activities/cached` — return the last synced feed
    immediately, without syncing Garmin, or an empty feed before the first sync.
- **Shared types** — `llmSettings`, `llmModel`, `coachAnalysis`,
  `analyzedActivity`, and their response schemas.

## Technical approach

### API (`apps/api/src/llm/`)

- `openrouter.ts` — `LlmProvider` implementation with injectable `fetch` for
  tests. Maps 401 → `LlmAuthError`, 402 (no credits) → distinct message,
  transport failures → 503. No SDK dependency.
- `activityPrompt.ts` — aggregate stats per channel, even downsampling to 90
  samples (first/last kept), a compact `elapsed | channel…` table, the current
  week plan, and system instructions to match the activity to a planned session
  without trusting the device's activity type (a 3–5 sentence coach response
  with one recommendation).
- `analyze.ts` — one completion per activity (temperature 0.3, 2048 max
  tokens). Reasoning models count reasoning against that budget; completions
  with `finish_reason: "length"` are rejected rather than shown truncated.
- `planCompletion.ts` — plan generations request `reasoning: { effort:
"minimal" }` so most of the output budget is available for the JSON. If a
  model still stops at the limit, it retries with reasoning disabled and a
  doubled budget before falling back to no reasoning control.
- `store.ts` / `analysisStore.ts` — Drizzle upserts and model-scoped cache reads.
- `coaching/feedCache.ts` — stores the last successfully synced feed per user
  (`activity_feed_cache`) so the page can render it while a new sync runs.
- `routes/llm.ts` — settings + catalog; `routes/coaching.ts` — sync, bounded
  concurrency (3), cached-or-fresh analyses, per-activity error isolation. The
  response carries activity summaries and a `sampleCount`; the full timeseries
  stays server-side (it is only needed to build the prompt).
- `crypto/credentials.ts` — shared AES-256-GCM helper extracted from the Garmin
  integration; Garmin keeps a thin re-export, LLM has its own env key.

### Web (`apps/web/src/`)

- `LlmSection.tsx` — key + model form; catalog loaded via
  `GET /api/llm/models`, manual entry fallback.
- `ActivityCard.tsx` — presentational activity summary + analysis.
- `CoachDashboard.tsx` — loads Garmin/LLM status, then the latest analysed
  activities; offers "Sync & re-analyze".
- `GarminSection.tsx` now only handles credential entry/connection state;
  activity sync and display moved to the dashboard.

## Testing

- **Unit (shared):** settings/update/model/analysis schemas and defaults.
- **Unit (API):** prompt content, downsampling, channel stats, provider client
  (model normalization/prices, key validation, completion, 401/402/empty),
  bounded-concurrency helper.
- **Unit (web):** `ActivityCard` rendering with analysis, error, and fallback.
- Existing Garmin crypto tests continue to pass through the shared crypto move.
- Run `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`.

## Risks / open questions

- **Cost:** each uncached activity costs one completion. Default limit 10 and
  caching bound the spend; no budget enforcement yet.
- **Privacy:** activity timeseries (including heart rate) is sent to OpenRouter.
  This is required for LLM coaching and is an accepted risk for personal use.
- **Availability:** OpenRouter or the chosen model being down shows per-activity
  errors (or a 401/503 for key/transport failures) rather than blanking the app.
- **Long requests:** analysing a batch can exceed Bun's default 10s idle
  timeout. The server sets `idleTimeout: 255`; without it Bun closes the
  connection and the Vite dev proxy reports HTTP 502 even though analyses are
  saved. A future streaming/progress response would remove the long wait.
- **Duplicate work in React StrictMode/dev:** the initial analysis request can
  run twice; the cache prevents re-billing once the first request persists.
  Server-side in-flight deduplication is a possible later refinement.
- **Deploy wiring:** `LLM_CREDENTIALS_KEY` is injected in Cloud Run (alongside
  the Garmin key) from the `TEST_LLM_CREDENTIALS_KEY` /
  `PROD_LLM_CREDENTIALS_KEY` repo secrets.

## Definition of done

- Configuration form saves a validated key + model and never echoes the key.
- Latest Garmin activities render with coach analyses that cite timeseries data.
- Cache reuse, model-change invalidation, and forced refresh work.
- Migrations `0002`–`0004` apply; all four quality gates pass.
