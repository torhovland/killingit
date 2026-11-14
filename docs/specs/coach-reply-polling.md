# Spec: Polling for a coach reply

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** `docs/specs/dashboard-layout.md`,
  `docs/specs/web-coaching-hooks.md`, `docs/specs/web-coaching-pages.md`,
  `docs/specs/web-api-resource-hook.md`

## Goal

The coaching dashboard checks the stored feed while a saved comment is still
waiting for the coach's reply. The check must never stack: however slow a
response is, the next check only starts after the previous one has finished, so
two responses cannot be applied out of order and a slow API cannot leave a
growing queue of requests behind a page the athlete has already left.

## Scope

### In scope

1. **`apps/web/src/coachReplyPoll.ts`** — `pollCoachReplies` owns the loop:

   - it waits `COACH_REPLY_POLL_INTERVAL_MS` (1.5 s) before each attempt;
   - it stops when `isActive()` is false, so an answered comment or an unmounted
     dashboard ends the poll;
   - it stops after `COACH_REPLY_POLL_ATTEMPTS` (40) attempts, so a reply that
     never arrives cannot keep the page polling for the whole visit;
   - it `await`s `loadCached()` before the next attempt is even scheduled, which
     is what rules out overlapping requests;
   - a rejected attempt does not end the poll, because the loader has already
     reported its own failure and the next tick may succeed.

2. **`CoachDashboard`** starts the loop from its existing effect while
   `awaitingReplies` is true and marks the loop inactive in the effect's
   cleanup. The timer still belongs to the dashboard, not to
   `useActivityFeed`, which keeps exposing only `awaitingReplies` and
   `loadCached` (see `docs/specs/web-coaching-hooks.md`).

3. **`apps/web/src/coachReplyPoll.test.ts`** covers the loop's contract with an
   injected `sleep`: a request settles before the next one starts, the attempt
   cap and interval hold, an inactive caller stops the poll, and a failed
   attempt does not.

### Out of scope

- The API routes and their payloads. The poll reads the existing
  `GET /api/coaching/activities/cached`.
- `pollPlanGeneration` (`apps/web/src/planGeneration.ts`), which already awaits
  each status response before the next one; it keeps its own loop.
- Aborting a request the browser has already sent when the dashboard unmounts.
  Its response only re-merges the same server feed into the browser cache.
- Moving the poll into `useActivityFeed`.

## Decisions

A chained loop was chosen over keeping `setInterval` with an in-flight flag: the
loop makes "one request at a time" the shape of the code instead of a guard the
next edit has to remember, and it keeps the 1.5 s cadence measured from a
settled response rather than from an earlier tick.

No new dependency, route, schema or migration is involved, so no ADR is added;
the choice follows the existing `pollPlanGeneration` pattern.

## Acceptance criteria

1. Two cached-feed loads can never overlap, and the next load starts only after
   the previous response settled.
2. The dashboard stops polling when the reply arrives, when it unmounts, and
   after 40 attempts.
3. A rejected load leaves the feed on screen and the poll running.
4. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`,
   `bun run check:unused`, `bun run test:coverage` and `bun run test:e2e` pass.
