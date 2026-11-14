# ADR 0039: The Garmin supplementary pass runs in the background

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** `docs/specs/garmin-daily-health-metrics.md`,
  `docs/specs/activity-feed-loading.md`, `docs/specs/body-metrics.md`,
  `docs/specs/coach-run-cancellation.md`, ADR 0003

## Context

The activity sync stores Garmin's 42-day activity window. Next to it, one
shared fail-open pass in `apps/api/src/garmin/supplements.ts` refreshes Garmin's
weigh-ins and historic FTP and backfills daily health and recovery. The
daily-health part walks up to 43 dates one after another, because Garmin rate
limits aggressive callers, and the per-day watermark it writes only helps on
the _next_ pass.

Both callers — the activity feed (`GET /api/coaching/activities`, through the
feed's sync phase) and `GET /api/garmin/activities` — used to await that pass
before answering. A first visit therefore waited for the whole backfill, and
the athlete's dashboard was held up by data none of the feed's response
carries.

## Decision

- `syncGarminSupplements` stays the pass: the metrics-and-FTP refresh, then the
  sequential, rate-limit-aware, watermark-resumable daily-health backfill.
- `startGarminSupplements(userId, pass)` starts that pass in the background and
  returns at once. The caller does not await it, so its response is written as
  soon as the activities are stored.
- **One pass per account at a time.** A process-local map holds the running
  pass per account, and a caller that arrives mid-pass joins it instead of
  starting a second one, so two requests never write the same metrics
  concurrently. The map is bounded by the accounts mid-pass and an entry is
  removed when its pass settles (`docs/specs/coach-run-cancellation.md` follows
  the same process-local convention).
- **The pass is fail-open and self-contained.** It takes the account id, the
  decrypted credentials and the athlete's local day — never the request, its
  `AbortSignal` or a request-scoped context — so it may keep running after the
  response. The scheduler catches and logs anything the pass throws, and the
  returned promise always resolves, so a background failure can neither reject
  an unawaited task nor fail a response that was already written.
- The pass starts immediately, in the same tick as the request that triggered
  it, rather than on a timer: Cloud Run allocates CPU to a request, and a
  deferred start could be frozen before it ever ran.

## Consequences

- The feed and `GET /api/garmin/activities` answer with the activities they
  already have; body metrics, FTP and daily health appear in the next visit's
  prompts and pages.
- On Cloud Run's request-based billing the container's CPU is throttled between
  requests, so a background pass may be paused after the response and resumed
  by the next request to the same instance, or lost if the instance is torn
  down. Nothing is corrupted: the pass is idempotent, writes watermarks per
  stored day, and refreshes today and yesterday on every run, so the next visit
  continues where it stopped. This is the same trade-off coach runs already
  make (`docs/specs/coach-run-cancellation.md`); a background worker remains
  the future fix for both.
- A pass that is already running for the account is joined rather than
  restarted, so two visits in quick succession do one backfill, and the second
  visit's athlete day is refreshed by the next pass (today and yesterday are
  always re-fetched then).
- The activity sync still runs first and in the request: daily health is never
  fetched without fresh activities, and a failed activity sync still fails the
  feed.

## Rejected alternatives

- **Run the two parts concurrently inside the request:** it overlaps the
  weigh-in/FTP refresh with the backfill, but the 43 sequential daily-health
  calls still hold the response, which is the cost this decision removes.
- **Fan the 43 days out concurrently:** faster, but it is exactly the burst of
  sidecar calls that Garmin rate limits, and a rate limit would leave most of
  the window unmarked.
- **Await the pass with a deadline and continue after it:** the response would
  still wait for the deadline, and the deadline logic buys nothing over starting
  the pass in the background at once.
- **A separate worker, queue or Cloud Run job:** the right long-term home for
  this work, and more moving parts than one shared fail-open pass warrants
  today. The background start keeps the call site unchanged when it arrives.
