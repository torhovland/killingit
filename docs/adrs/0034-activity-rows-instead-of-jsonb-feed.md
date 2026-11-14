# ADR 0034: Store synced activities as rows

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** `docs/specs/activity-store.md`, issue #280

## Context

`activity_feed_cache.feed` held every activity ever synced for an account as one
`JSONB` value. Each activity carried its summary, up to 120 sample points, laps,
strength sets and a GPS route. The whole value was rewritten twice on every
sync and loaded whole by the Calendar, the Fitness page, the manual-activity
list and the cached activity feed. The payload grew without bound, every page
paid for fields it did not use, and one slow writer rewrote every activity.

The coach's analysis and the athlete's feedback were also copied into that
value even though they already live in `activity_analyses`,
`activity_comments`, `coach_replies` and `activity_reviews`.

## Decision

- Add an `activities` table with one row per `(user, Garmin activity id)`.
- Keep the scalar summary in ordinary columns. Keep the bounded sample preview
  and GPS route in `JSONB` columns that are selected only when a caller asks for
  them.
- Write only the current 42-day sync window on each sync, upserting rows in
  place, and delete locally removed activities. Older rows stay untouched.
- Do not copy coach work onto the row. `loadStoredActivityFeed` joins the
  stored general and program analyses and the athlete's feedback when it builds
  the feed.
- Derive each activity's TSS and its day's training-load snapshot when the feed
  is served instead of storing them.
- Migration `0052` creates the table, copies every activity out of the old
  `JSONB` feed, then drops `activity_feed_cache`. The copy keeps history older
  than Garmin's sync window, which a fresh sync could not recover.

## Alternatives considered

- **Keep one JSONB cache and trim it.** Rejected: the page still loads every
  activity, and the unbounded payload remains.
- **A second preview table.** Rejected as unnecessary: selecting explicit
  columns from one table already keeps the preview off the summary queries, and
  one table keeps the write and migration simple.
- **Store analyses and feedback on the activity row.** Rejected: it duplicates
  the authoritative tables and goes stale when a reply is written after the
  analysis.
- **Drop the cache without copying.** Rejected: activities that have left
  Garmin's 42-day sync window and their analyses would be lost.

## Consequences

- Calendar, fitness, manual-activity and prompt loads read a bounded set of
  scalar columns; only the activity feed and the calendar's route map select the
  preview or route.
- A sync no longer rewrites the whole history, so the write cost follows the
  sync window rather than the athlete's lifetime of activities.
- Coach work cannot drift from its own tables, and a reply appears as soon as
  it is stored.
- Training load is recomputed per read, so it always reflects the current
  thresholds, plan and manual entries.
- The activity feed's `model` field is `null` for the stored feed; the live sync
  still reports the model that produced its analyses.
