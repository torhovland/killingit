# Spec: Shared coaching data hooks

- **Status:** Accepted (implemented)
- **Date:** 2026-11-07
- **Related:** `docs/specs/dashboard-layout.md`,
  `docs/specs/garmin-activity-integration.md`,
  `docs/specs/activity-deletion.md`, `docs/specs/web-coaching-pages.md`

## Goal

Keep the two pages that show the activity feed — the coaching dashboard and the
Activities page — on one implementation of the feed, status, comment, delete and
cache logic, so a fix or behaviour change reaches both pages at once.

## Scope

### In scope

1. **`useStatuses(auth)`** loads the Garmin connection status and the LLM
   settings in parallel, validates both responses, and exposes the two values,
   a loading flag, an error message, and a `reload` action.
2. **`useActivityFeed(auth, timeZone, options)`** owns:
   - the feed on screen, seeded from the per-account browser cache;
   - loading the live feed (with `today`, `timezone`, and optional `refresh`);
   - loading the stored server feed and merging it into the feed on screen;
   - writing every successful feed to the browser cache;
   - deleting an imported activity and rebuilding the feed;
   - saving or editing an activity comment, including its reply;
   - marking an activity as reviewed with no comment;
   - the pending-reply flag used to poll for a reply;
   - a revision counter that increments when the feed changes enough to
     refresh the plan;
   - the `keepAnswered` option, which keeps an activity the athlete commented on
     visible for the rest of the visit (the dashboard's only intentional
     difference).
3. Both pages consume these hooks. The pages keep only their own presentation
   state and the dashboard-only features (reviews, weekly note, coach
   questions, plan section).

### Out of scope

- Extracting the review, weekly-note or coach-question loaders; that is done in
  `docs/specs/web-coaching-pages.md`.
- Changing the API routes or their payloads.
- Moving the dashboard's reply polling inside the hook; the hook exposes the
  `awaitingReplies` flag and `loadCached`, and the dashboard keeps the timer.

## Target structure

- `apps/web/src/useStatuses.ts` — the two integration statuses.
- `apps/web/src/useActivityFeed.ts` — the feed and its mutations.
- `apps/web/src/coachingSave.ts` — the shared `{ message, reply }` response
  parser.
- `apps/web/src/activityCache.ts` — cache storage, merge, and the pure feed
  transformations used by the hook.
- `apps/web/src/ActivitiesPage.tsx` and `apps/web/src/CoachDashboard.tsx` —
  consume the hooks and render the returned state.

## Acceptance criteria

1. `coachingDateQuery`, `deleteActivity`, `submitComment`, the status loaders
   and the cache writes exist in one place.
2. The Activities page still lists the full feed, supports manual activities,
   sync / re-analyse, comments and delete.
3. The dashboard still shows only pending activities, keeps a commented-on
   activity for the visit, and polls for the coach's reply.
4. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass, and existing web tests need no changes.
