# Spec: Activity feed loading phases

- **Status:** Accepted
- **Date:** 2026-11-12
- **Related:** `docs/specs/garmin-activity-integration.md`,
  `docs/specs/training-load.md`, `docs/specs/coach-questions.md`

## Goal

Keep `loadAnalyzedActivitiesOnce` readable as a sequence of named phases so the
happy path reads top to bottom and each failure path sits with the phase that
can fail. Syncing, analysis caching, coach-question handling, estimate storage,
training-load fallbacks and feed assembly are unchanged in behaviour. The one
exception is a failed read of the stored history: the sync aborts instead of
merging the sync window with an empty history and hiding every older activity.

## Scope

`apps/api/src/coaching/activities.ts`:

- `syncFeed` — syncs Garmin activities, body metrics and daily health; drops
  locally deleted activities; merges the stored history; and persists only the
  sync window before analysis. The stored history is read before anything is
  written, and a failed read aborts the sync: merging the sync window with an
  empty history would hide every older activity and its coach work. Activity
  rows are stored by `coaching/activityStore.ts`; see
  `docs/specs/activity-store.md`.
- `loadAnalysisInputs` — loads LLM settings, athlete feedback, the stored plan,
  daily health, body history and diet in parallel, then the training context.
  A training-context failure falls back to empty loads instead of failing the
  feed.
- `analyzeMissing` — loads the cached general and program analyses (skipped on
  an explicit refresh), reuses an analysis unless the athlete commented after
  it, analyses the rest concurrently, saves each result, replaces the previous
  activity question, and stores returned FTP and body estimates oldest first.
- `assembleFeed` — attaches athlete feedback, the day's fitness snapshot and
  each activity's own TSS. It no longer writes a second cache copy: the sync
  stored the rows and the analysis phase stored its analyses.

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
- The response shape, question handling, metric writes and log messages are
  unchanged.
- Existing tests pass unchanged, and new tests cover the orchestrator's branches.
- A failed read of the stored history aborts the sync, so the sync window is
  never written when the history could not be read first.

## Data-model and API impact

The send and receive shapes are unchanged. Storage moved from one
`activity_feed_cache.feed` value to the `activities` rows documented in
`docs/specs/activity-store.md` and ADR 0034.
