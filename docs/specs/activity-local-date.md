# Spec: An activity belongs to the athlete's local day

- **Status:** Accepted
- **Date:** 2026-11-12
- **Related:** `docs/specs/user-time-zone.md`,
  `docs/specs/training-load.md`, `docs/specs/calendar-page.md`,
  `docs/specs/activity-feed-loading.md`,
  `docs/specs/coach-reply-context.md`, ADR 0008.

## Goal

An activity's `startDate` is an ISO UTC instant (`packages/shared/src/activity.ts`;
the Garmin sidecar prefers `startTimeGMT`). Every place that turns it into a day
used to take its first ten characters, which is the UTC date. A ride that starts
at 23:30 in `America/Los_Angeles` is therefore counted on the next day, and a run
that starts at 00:30 in `Asia/Tokyo` on the day before. Today's completion,
completed and missed sessions, daily TSS/ATL/CTL, the Fitness chart, the
calendar, the coach prompts and the activity's own analysis all shifted with it.

An activity now belongs to the athlete's local calendar day: the day of the
instant in the athlete's IANA time zone.

## Scope

### In scope

1. One shared helper, `activityLocalDate(activity, timeZone)`, that reads an
   activity's `startDate` as a wall-clock date in an IANA zone. It is defined
   next to `zonedDateTime` in `packages/shared/src/wallClock.ts` so the API and
   the web app cannot disagree.
2. Every production use of `activity.startDate.slice(0, 10)` is replaced by the
   helper, and the athlete's effective time zone is passed to it.
3. A stored-zone fallback: the effective zone is `null` for an account that has
   not chosen one, and `zonedDateTime` then reads the instant in UTC. The
   fallback is the existing shared one, not a second copy.
4. A source-scanning test that fails when a new `startDate.slice(0, 10)` appears
   in the API or the web app.

### Out of scope

- Changing the stored `startDate` of an activity, its analysis, or a plan date.
  Only the derived calendar day changes.
- Re-deriving the day of a manually recorded activity: a manual entry already
  stores a plain `YYYY-MM-DD` date and is never converted.
- Per-user zones in an admin or multi-athlete view.

## Effective time zone

The zone a request carries (the web app's selected or device zone) wins, then
the `users.timezone` value stored by the settings page, and `null` (UTC) only
when the account has neither.

- Coaching requests already carry `timezone`; the API resolves it against the
  account row (`query.timezone ?? user.timezone`).
- The stored-feed, calendar and fitness reads gain an optional `timezone` query
  parameter and fall back to `users.timezone`.
- Plan generation resolves the zone once in the trigger (`timezone ??
user.timezone`) and keeps it on `PlanGenerationContext`, so every
  `applyCompletedDays`, activity grouping and day-status call inside a run uses
  the same zone.

Manual activities keep their plain date and never pass through the helper.

## Data model / API impact

None. No schema change, no migration, no stored shape change. Three read
endpoints accept an optional `timezone` query parameter:

- `GET /api/coaching/activities/cached?timezone=`
- `GET /api/calendar?today=&timezone=`
- `GET /api/fitness?today=&range=&timezone=`

An unknown or missing zone reads as UTC, as `docs/specs/user-time-zone.md`
already specifies for every wall-clock conversion.

## Technical approach

- `activityLocalDate(activity, timeZone)` is a thin wrapper over
  `zonedDateTime(new Date(activity.startDate), timeZone).date`.
- The grouping and load functions take the zone as a required argument so a new
  call site cannot silently inherit UTC:
  `groupActivitiesByDate(activities, timeZone)`,
  `buildActivityLoads(activities, timelines, estimatedTssByDate, extraDates,
timeZone)`, `earliestRecordedDate(activities, manualActivities, timeZone)`,
  `applyCompletedDays(week, activities, today, manualActivities, todayPlan,
timeZone)`, `applyTrainingLoad(plan, context)` with `context.timeZone`, and
  `currentTrainingLoad(context, today)` with `context.timeZone`.
- The activity-analysis prompt context carries the zone on
  `ActivityAnalysisContext.timezone`, so the planned-session match, the health
  window and the body history all use the activity's local day.

## Acceptance criteria

1. A ride at `2026-11-12T07:30:00Z` (23:30 on 11 November in
   `America/Los_Angeles`) counts on 11 November for a Los Angeles athlete: its
   TSS, the day's ATL/CTL/TSB, and the planned session it completes.
2. A run at `2026-11-11T15:30:00Z` (00:30 on 12 November in `Asia/Tokyo`) counts
   on 12 November for a Tokyo athlete.
3. The same two activities still count on 12 and 11 November respectively for a
   UTC athlete, so the change is zone-driven and not a date shift.
4. The calendar, Fitness chart, activity analysis prompt, coach reply context
   and cached feed all show the same local day for an activity.
5. A manual entry stays on the date the athlete entered.
6. `startDate.slice(0, 10)` does not reappear in production code; the guard test
   fails if it does.
7. Typecheck, lint, format, unit tests and the database integration tests pass.

## Testing

- Shared: `activityLocalDate` for both boundary cases, the UTC fallback, DST,
  and an invalid zone.
- API: activity-load grouping, `applyCompletedDays` completion on the local day,
  the calendar's entry day, the fitness history's day, and the analysis prompt's
  activity date, each with a zone that moves the date.
- A source scan over `apps/api/src` and `apps/web/src` rejects
  `startDate.slice(0, 10)` outside test files.
- Web: the activity comment carries the local activity date.
