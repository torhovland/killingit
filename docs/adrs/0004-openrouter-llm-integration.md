# ADR 0004: LLM access via OpenRouter

- **Status:** Accepted
- **Date:** 2026-10-20
- **Deciders:** torhovland

## Context

The app's core value is coaching generated from an athlete's training data. The
first data source is in place (Garmin, ADR 0003), including per-activity
timeseries, but nothing yet turns that data into coach analysis.

`AGENTS.md` states that we use a model from **OpenRouter** by default and that
the LLM integration must sit behind a provider-agnostic interface so per-user
keys for OpenRouter, OpenAI, Anthropic, or another provider can be added later.
The current phase is single-operator (ADR 0003), so a single stored key is
sufficient for now.

## Decision

- **Integrate OpenRouter's chat-completions API** behind an `LlmProvider`
  interface (`apps/api/src/llm/openrouter.ts`). The interface exposes
  `listModels`, `validateKey`, and `complete`; the coaching route depends only
  on that interface.
- **The operator configures the key and model in the app.** The key is
  validated against OpenRouter (`GET /key`) before storage, encrypted at rest
  with AES-256-GCM using a key derived from `LLM_CREDENTIALS_KEY`, and never
  serialized back to the client. `GET /api/llm/models` exposes the model
  catalog (public on OpenRouter) for the picker.
- **Analyse each of the latest synced Garmin activities.** The prompt includes
  the activity summary, aggregate channel statistics (heart rate, power, speed,
  cadence, elevation, temperature, distance), and an evenly downsampled
  timeseries (up to 90 rows, first and last points preserved) so the model can
  reason about how the workout unfolded. Each analysis is 3–5 plain-text
  sentences ending in one actionable recommendation.
- **Cache analyses in Postgres** (`activity_analyses`), keyed by source
  activity id, so revisiting the page does not re-bill tokens. An analysis is
  regenerated when the selected model changes; `?refresh=true` forces a fresh
  pass.
- **Fail per activity, not per batch**: one provider error yields an
  `analysisError` on that card while the rest still render. An invalid/revoked
  key (401) fails the whole request so the operator sees the real problem.

## Security and privacy

- The API key is encrypted at rest and never returned by any endpoint; only
  `configured`, `provider`, and the selected model are exposed.
- Activity summaries and timeseries (including heart rate) are sent to
  OpenRouter as prompt content. This is inherent to LLM coaching and is
  documented in the spec.
- Model ids are validated against OpenRouter's catalog before saving, so typos
  fail at configuration time rather than per activity.

## Consequences

- **Positive:** working coach analysis for real Garmin activities with no
  provider lock-in at the route level; token spend is bounded by caching and a
  10-activity default (max 20 per request); the key can be rotated independently
  of the Garmin credential key.
- **Negative / limits:** single stored key (not yet per user); activity data
  leaves the system to a third-party LLM provider; the first analysis of each
  activity costs one completion; OpenRouter availability becomes a dependency
  of the coaching page.
- **Follow-ups:** per-user keys and provider choice (add a `user_id`/provider
  dimension and a `user_provider_keys` table); persist full activities so the
  page does not re-sync Garmin on every visit; add a coaching conversation and
  workout-steering input (product vision); add deploy-time injection of
  `LLM_CREDENTIALS_KEY` alongside the Garmin key.

## Rejected alternatives

- **Call OpenAI/Anthropic directly now:** more integrations to build; OpenRouter
  already provides one API over many models and is the stated default.
- **Keep the key in the browser:** exposes it to every script on the page and
  cannot be used for server-side prompting.
- **A provider SDK dependency:** the HTTP API is small and keeps the provider
  seam explicit; no extra package is needed.

## References

- `AGENTS.md` — LLM requirements and development methodology.
- `docs/specs/openrouter-llm-integration.md` — implementation spec.
- `docs/adrs/0003-garmin-activity-data-access.md` — Garmin data source.
- OpenRouter API: https://openrouter.ai/docs/api-reference/overview
