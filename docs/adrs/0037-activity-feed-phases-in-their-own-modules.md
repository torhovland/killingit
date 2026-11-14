# ADR 0037: Activity feed phases live in their own modules

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** `docs/specs/activity-feed-loading.md`, ADR 0034, ADR 0035,
  issue #292

## Context

`apps/api/src/coaching/activities.ts` had grown to roughly 950 lines and mixed
six concerns: the feed orchestration, the Garmin sync, the LLM key handling, the
activity analysis, the response mapping, and the feed's own error classes and
fail-open wrappers. Two recent changes landed in it — extracting the
supplementary Garmin sync (#287) and moving upstream failures onto typed errors
with one route mapper (#288, #289) — and each one had to read the whole file to
find its own concern. Nothing failed because of it, but the phases were only
separable by comment, and a reviewer of the sync window scrolled past the
prompt plumbing.

## Decision

- `apps/api/src/coaching/activities.ts` keeps only the orchestrator:
  `loadAnalyzedActivities` (resolve the athlete's day, join the account's shared
  analysis pass), `loadAnalyzedActivitiesOnce`, and the injectable phase set the
  tests drive.
- `apps/api/src/coaching/feed/sync.ts` owns the Garmin sync: credential loading,
  the activity and supplementary sync, the stored-history merge, and persisting
  the sync window.
- `apps/api/src/coaching/feed/analysis.ts` owns the prompt inputs and the
  analysis pass: the parallel input loads, the cached-or-fresh decision, the
  estimate writes, and the fail-open readers for daily health and body history.
- `apps/api/src/coaching/feed/presenter.ts` owns the response: the
  `ActivityFeed` shape, the helpers that build one activity's entry, and the
  training-load helpers the feed and calendar routes use.
- `apps/api/src/coaching/feed/errors.ts` owns the feed's own credential
  failures, `GarminCredentialsError` and `LlmCredentialsError`. It only _uses_
  the shared `UpstreamError`, which stays in `http/errors.ts` because every
  route answers with it (ADR 0035).
- Each caller imports the module that owns the helper it needs. `activities.ts`
  is not a barrel.

## Alternatives considered

- **Keep `activities.ts` as a barrel that re-exports the phases.** Rejected: the
  module surface would stay one module in practice, and with
  `ignoreExportsUsedInFile` a helper that lost its last caller would no longer
  show up in `bun run check:unused`.
- **Move the `UpstreamError` hierarchy into `feed/errors.ts`.** Rejected: the
  Garmin and OpenRouter failures extend it too, and ADR 0035 puts it where every
  route can reach it. A second copy would be the duplication that refactor was
  meant to remove.
- **Split `analysis.ts` further into inputs and analysis.** Rejected for now:
  the input loaders and the analysis pass share `AnalysisInputs`, so a fifth
  module would only move one parameter object between neighbours.
- **Leave the file as it was.** Rejected: two changes in a row had already had
  to work around its size, and the next one would too.

## Consequences

- The orchestrator's happy path is about 100 lines and reads as provider →
  credentials → sync → inputs → analyse → assemble, with each phase next door.
- Behaviour is unchanged: the same response shape, question handling, metric
  writes, log messages and error statuses. The tests moved with the modules and
  keep their assertions; only import paths and file placement changed.
- A concern can be reviewed on its own, and the feed's error classes sit with
  the feed rather than in a route or a provider module.
