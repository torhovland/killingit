# Spec: Shared coaching data hooks

- **Status:** Accepted (implemented)
- **Date:** 2026-11-07
- **Related:** `docs/specs/dashboard-layout.md`,
  `docs/specs/garmin-activity-integration.md`,
  `docs/specs/activity-deletion.md`, `docs/specs/web-coaching-pages.md`,
  `docs/specs/coach-reply-polling.md`

## Goal

Keep the pages that show the activity feed — the coaching dashboard and the
Activities page — on one implementation of the feed, status, comment, delete and
cache logic, so a fix or behaviour change reaches both pages at once. The
integration statuses are loaded the same way everywhere they appear, including
the settings page and the plan-regeneration buttons.

## Scope

### In scope

1. **`useStatuses(auth, options)`** loads the Garmin connection status and the
   LLM settings in parallel, validates both responses, and exposes the two
   values, a loading flag, an error message, a `reload` action, and `setData` so
   a page can replace a status it just saved. It forwards the optional
   `ApiResourceOptions` to `useApiResources`, so a page that owns a header
   spinner registers its `statusSource` without rebuilding the requests. The
   dashboard, the Activities page, `settings/SettingsPage.tsx` and
   `PlanRegenerationButtons.tsx` all read the statuses through it.
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
  `awaitingReplies` flag and `loadCached`, and the dashboard keeps the timer
  (`docs/specs/coach-reply-polling.md`).

## Target structure

- `apps/web/src/useStatuses.ts` — the two integration statuses.
- `apps/web/src/activities/useActivityFeed.ts` — the feed and its mutations.
- `packages/shared/src/plan.ts` — `coachingInputSaveResponseSchema`, the shared
  `{ message, reply }` response contract of the comment, review, weekly-note and
  manual-activity saves.
- `apps/web/src/activities/activityCache.ts` — cache storage, merge, and the pure
  feed transformations used by the hook.
- `apps/web/src/activities/ActivitiesPage.tsx` and
  `apps/web/src/coach/CoachDashboard.tsx` consume the hooks and render the returned
  state.

Single-page hooks share that home: a hook used by one page or section lives in
its feature directory beside its consumer, as `apps/web/src/plan/useCoachPlan.ts`
and `apps/web/src/plan/usePlanWorkoutDownload.ts` do for the coaching dashboard's
plan section. Only a hook that more than one page needs joins the shared list
above.

## Acceptance criteria

1. `coachingDateQuery`, `deleteActivity`, `submitComment`, the status loader
   and the cache writes exist in one place.
2. The Activities page still lists the full feed, supports manual activities,
   sync / re-analyse, comments and delete.
3. The dashboard still shows only pending activities, keeps a commented-on
   activity for the visit, and polls for the coach's reply.
4. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass, and existing web tests need no changes.
