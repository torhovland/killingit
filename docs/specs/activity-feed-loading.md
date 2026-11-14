# Spec: Activity feed loading phases

- **Status:** Accepted
- **Date:** 2026-11-12
- **Related:** `docs/specs/garmin-activity-integration.md`,
  `docs/specs/training-load.md`, `docs/specs/coach-questions.md`

## Goal

Keep `loadAnalyzedActivitiesOnce` readable as a sequence of named phases so the
happy path reads top to bottom and each failure path sits with the phase that
can fail. Syncing, analysis caching, coach-question handling, estimate storage,
training-load fallbacks and feed persistence are unchanged. The one exception
is a failed read of the stored feed: the sync aborts instead of merging the
sync window with an empty history and overwriting every older activity.

## Scope

The feed lives in `apps/api/src/coaching/feed/`, split by responsibility so no
module mixes Garmin, the model and response shaping:

- `sync.ts` — the orchestrator `loadAnalyzedActivities` plus the Garmin sync and
  stored-history handling (`syncFeed`, `extendStoredFeed`). It owns the
  provider, credential and feed-cache plumbing.
- `analysis.ts` — the LLM analysis pass: input loading, the cached-or-fresh
  decision, concurrent analysis, coach-question handling, estimate storage and
  `loadUserActivityTrainingLoads`.
- `presenter.ts` — every function that builds an `AnalyzedActivity`: the summary
  and preview downsampling, the feedback and training-load overlays, the history
  merge, and the mappings from a stored or failed analysis.
- `errors.ts` — `GarminCredentialsError` and `LlmCredentialsError`.

`sync.ts` depends on `analysis.ts` and `presenter.ts`, `analysis.ts` on
`presenter.ts`, and `presenter.ts` on neither, so the modules form a directed
graph with no cycle. Importers point at the module that owns the symbol; there
is no re-export barrel.

The phases themselves:

- `syncFeed` — syncs Garmin activities, body metrics and daily health through
  `syncGarminFeed`, which delegates the supplementary passes to
  `garmin/supplements.ts`; drops locally deleted activities; merges the stored
  history; and persists the full history before analysis. The stored feed is
  read before anything is written, and a failed read aborts the sync: merging
  the sync window with an empty history would erase every older activity and
  its coach work.
- `loadAnalysisInputs` — loads LLM settings, athlete feedback, the stored plan,
  daily health, body history and diet in parallel, then the training context.
  A training-context failure falls back to empty loads instead of failing the
  feed.
- `analyzeMissing` — loads the cached general and program analyses (skipped on
  an explicit refresh), reuses an analysis unless the athlete commented after
  it, analyses the rest concurrently, saves each result, replaces the previous
  activity question, and stores returned FTP and body estimates oldest first.
- `assembleFeed` — attaches athlete feedback, the day's fitness snapshot and
  each activity's own TSS, then persists the feed.

The phase results are explicit objects (`SyncedFeed`, `AnalysisInputs`,
`TrainingInputs`, `ActivityAnalysisOutcome`) instead of mutable locals threaded
through the function. Provider and credential resolution stay in small typed
helpers (`loadGarminCredentials`, `loadLlmApiKey`).

The orchestrator accepts an optional phase set that defaults to the real
implementations, so a unit test can drive every branch of the top-level flow —
no LLM configured, daily-model selection, and model fallback — without Garmin,
the database, or a live model. This follows the injectable-dependencies pattern
used by `loadDietContext`.

## Acceptance criteria

- Every phase is a named function under roughly 80 lines.
- `loadAnalyzedActivitiesOnce` reads as provider → credentials → sync → inputs →
  analyse → assemble.
- The response shape, cache writes, question handling, metric writes and log
  messages are unchanged.
- Existing tests keep their assertions and move beside the module they cover,
  and the orchestrator's branches stay covered.
- A failed read of the stored feed aborts the sync, so the history is never
  written when it could not be read first.
- Each module stays close to one responsibility: Garmin and persistence in
  `sync.ts`, the model in `analysis.ts`, `AnalyzedActivity` shaping in
  `presenter.ts`, and the credential errors in `errors.ts`.

## Data-model and API impact

None. No route, schema, prompt, or response shape changes.
