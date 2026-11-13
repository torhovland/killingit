# Spec: Activity analysis sharing

- **Status:** Accepted
- **Date:** 2026-11-13
- **Related:** `docs/specs/activity-feed-loading.md`,
  `docs/specs/coach-plan-lifecycle.md`, `docs/specs/activity-local-date.md`

## Goal

Keep at most one activity-analysis pass running per account, so two passes can
never write the same activities, FTP and body estimates, or coach questions at
the same time. Overlapping requests for the same athlete's day share one Garmin
sync and one set of LLM analyses, and an explicit refresh waits for the pass in
flight instead of starting a second one beside it.

A pass is computed for one local day: it syncs and analyses activities for that
`today`, and its analysis context includes that day's plan fit. A request for a
different day therefore cannot join the pass, and a finished feed is only reused
for the day it was computed for.

## Scope

`apps/api/src/coaching/analysisRuns.ts`:

- `shareActivityAnalysis(userId, today, refresh, run)` serialises passes per
  account. An ordinary request with the same `today` joins the active pass. An
  explicit refresh, or a request for another day, waits for the active pass and
  then starts its own.
- Finished feeds are stored with the local day they were computed for.
  `latestActivityAnalysisSince` reads and waits only for the caller's day.

`apps/api/src/coaching/activities.ts` resolves `today` once, before entering the
registry, so the day that keys the pass is the day the pass was asked for.

`apps/api/src/plans/trigger.ts` passes its own `today` and `timezone` into the
initial activity load and asks `latestActivityAnalysisSince` for the same day,
so the plan shares the dashboard's pass and never adopts a feed analysed for
another day.

The registry is process-local. `activeAnalyses` drops an entry when its pass
settles, and `completedAnalyses` keeps the finished feed of the 32 most recently
used accounts, because each feed carries every analysed activity and its sample
previews. Reading a finished feed refreshes its account, so another account
finishing does not evict the feed a plan is about to use. Two instances may each
run their own pass for the same account; the stored analysis is still fenced by
the activity's own timestamps, and an evicted account analyses again on its next
request. See ADR 0014.

## Acceptance criteria

- A second ordinary request for the same account and day returns the active
  pass's promise.
- A `refresh` request never runs beside the active pass: it waits for that pass
  to settle and then runs its own.
- A request for another local day does not join the active pass; it waits for it
  and then runs its own.
- A failed pass is released, no chained caller is failed by the pass it was
  waiting for, and the next request can retry.
- `latestActivityAnalysisSince` waits for an active pass only when it is for the
  caller's day, and only returns a completed feed for that day.
- A finished feed survives while other accounts are evicted, up to the bounded
  number of retained accounts.
- The existing single-flight, failure-recovery and plan-run overlap behaviour is
  unchanged.

## Data-model and API impact

None. No schema, route, prompt, or response shape changes.
