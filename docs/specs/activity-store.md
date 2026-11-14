# Spec: Store activities as rows instead of one JSONB feed

- **Status:** Accepted
- **Date:** 2026-11-14
- **Issue:** #280
- **Related:** `docs/specs/activity-feed-loading.md`,
  `docs/specs/calendar-page.md`, `docs/specs/training-load.md`,
  `docs/specs/activity-local-date.md`, ADR 0034.

## Goal

Stop storing every synced activity inside one unbounded `JSONB` value
(`activity_feed_cache.feed`) that is rewritten twice per sync and loaded whole
by every page. Store one row per activity, let each loader read only the
columns it needs, and let the sample preview and GPS route load on demand.

## Scope

### In scope

1. An `activities` table with one row per `(user, Garmin activity id)`.
2. Scalar summary columns for everything the Calendar, Fitness page, manual
   activity list, training-load scoring and prompts need.
3. The bounded sample preview and GPS route in JSONB columns selected only by
   the activity feed and the calendar's route map.
4. A store that reads summaries, composes the coach's analyses and the
   athlete's feedback, writes only the sync window, and deletes locally removed
   activities.
5. A migration that copies the existing JSONB feed into rows before dropping
   the old table, so history older than Garmin's 42-day sync window survives.
6. The sync, cached feed, calendar, fitness, manual-activity and reply/prompt
   loaders moved onto the store.

### Out of scope

- Changing the shared API response shapes. `AnalyzedActivity` still carries the
  preview and route, so the web app does not change.
- Storing the full-resolution timeseries. Only the bounded preview is kept, as
  before.
- A searchable activity archive, pagination, or a second activity source.
- Changing the analysis cache. `activity_analyses`, `activity_comments`,
  `coach_replies` and `activity_reviews` remain the source of coach work.

## Behaviour

### Storage

- `activities` is keyed by `(user_id, activity_id)` and cascades on account
  deletion.
- A sync writes only the activities in its own sync window, upserting each row
  and its preview. It no longer rewrites the whole history.
- An activity that leaves the sync window keeps its row, analysis, comment and
  reply.
- A locally deleted activity is deleted from `activities` immediately when the
  athlete removes it, and is filtered out of later syncs by
  `activity_deletions`.
- The coach's analysis is not copied onto the activity row. It is read from
  `activity_analyses` (general and program), and the athlete's comment, reply
  and reviewed flag from their own tables, when the feed is loaded.

### Reading

- `loadStoredActivities(userId, scope)` returns rows newest first.
  - `none` (default) selects the scalar summary columns only.
  - `route` also selects the GPS route.
  - `samples` also selects the sample preview and route.
- `loadStoredActivityFeed(userId, scope)` adds the stored analyses and feedback.
- The cached feed route loads `samples`; the calendar loads `route` and the
  calendar response omits the sample preview; fitness, the manual-activity list
  and the reply/plan prompt context load `none`.
- Training load (each activity's TSS and its day's ATL/CTL/TSB) is derived when
  a feed is served rather than stored on the activity, so it cannot go stale.
- A failed read of the stored history still aborts a sync: merging the sync
  window with an empty history would hide every older activity from the
  response. A failed write is logged and does not fail the sync response.

## Data model / API impact

- `apps/api/src/db/schema.ts`: new `activities` table; `activity_feed_cache`
  removed.
- `apps/api/src/coaching/activityStore.ts`: `saveStoredActivities`,
  `loadStoredActivities`, `loadStoredActivityFeed`, `summarizeActivity`,
  `withActivityFeedback`, `MAX_ANALYZED_ACTIVITIES` and
  `MAX_PREVIEW_SAMPLES`. It replaces `coaching/feedCache.ts`.
- `apps/api/src/coaching/feed/sync.ts`: the sync phase persists the window
  through the store; the assembly phase no longer writes a second cache copy.
- `apps/api/src/routes/coaching/feed.ts`, `routes/calendar.ts`,
  `routes/fitness.ts`, `routes/coaching/manualActivities.ts`,
  `coaching/replyContext.ts`, `dependencies.ts` and
  `routes/coaching/dependencies.ts` read the store.
- `apps/api/src/coaching/deletions.ts` deletes the activity row in the same
  transaction as the deletion marker and feedback.
- `tools/benchmark/src/fixtures.ts` reads the fixture activities from the store.
- Migration `0052` creates `activities`, copies every activity from
  `activity_feed_cache.feed` (with its sample preview and route), then drops the
  old table. Analyses, comments and replies already have their own tables and
  are not copied.
- No shared schema or route response changes. The calendar now omits the
  sample preview (the schema already defaults it to an empty list), and every
  page gets the same fields it used before.

## Acceptance criteria

1. A sync stores only its sync window; re-running it updates rows in place and
   does not duplicate activities.
2. The stored history still spans every activity ever synced, including ones
   outside the current sync window.
3. Calendar, fitness, the manual list and prompt contexts load summary columns
   without selecting the sample or route JSONB.
4. The activity feed still shows the sample preview and route; the calendar
   still shows the route in its detail dialog.
5. Stored analyses and athlete feedback appear on the feed without being copied
   onto the activity row.
6. A locally deleted activity disappears from the feed and does not return on
   the next sync.
7. The migration preserves the existing feed's history before the old table is
   dropped.
8. Typecheck, lint, format, unit tests and the database integration suite pass.

## Testing

- Unit tests for the merge and edit-failure paths in `activities.test.ts`.
- Integration tests for upsert-in-place, preview scope, newest-first ordering,
  deletion, and composition with a stored analysis and comment.
- Existing route tests for the cached feed, calendar and fitness exercise the
  store through the injected loader.
