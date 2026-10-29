# Spec: Calendar page

- **Status:** Accepted (implemented)
- **Date:** 2026-10-27
- **Related:** `docs/specs/fitness-page.md`,
  `docs/specs/coach-plan-lifecycle.md`, `docs/specs/training-load.md`.

## Goal

Give the athlete a month view of what they did and what the coach has planned:
recorded activities, planned workouts, rest days, block starts, and the end of
the season. Selecting an entry opens its full details, including the athlete's
comment, the coach's response, and the route map for outdoor activities.

## Scope

### In scope

1. An authenticated endpoint returning the calendar's sparse day data and the
   months it may show.
2. A `Calendar` page reachable from the account menu.
3. Month navigation with previous/next buttons, a month picker, and a Today
   button, bounded by the available data.
4. A month grid (Monday start, six weeks) showing imported and manual
   activities, planned workouts and rest days, block starts, and the season
   end.
5. A detail dialog for activities and planned sessions.
6. Shared Zod schemas for the response and its entry types.

### Out of scope (deferred)

- Showing a detailed workout for every future day of the season. The stored
  plan only holds the current week and, after 18:00, the next week; later days
  appear as the coach plans each week. Season and block boundaries are shown
  for the whole season.
- Storing plan history. Past planned days that are no longer in the current or
  next week are represented by the activities the athlete recorded, not by the
  original plan session.
- Calendar editing, drag-and-drop, or creating activities from the page.
- Week, quarter, and year views.

## Behaviour

### Range

`GET /api/calendar?today=YYYY-MM-DD`

- `today` is required and must be `YYYY-MM-DD`.
- `earliestDate` is the earliest of the season start, imported activity dates,
  and manual activity dates. Without any of those it is `today`.
- `latestDate` is the latest of the season end, today, and the last planned
  session. Without a season it falls back to the last planned session or
  `today`.
- The page only allows months between those two dates; previous/next are
  disabled at the boundary and the month picker's `min`/`max` mirror them.

### Entries

- Imported activities use the cached analysed feed, so the dialog shows the
  same analysis, program review, comment, coach reply, training load, and GPS
  route as the Activities page.
- Manual activities show their description, the coach's reply, and the
  coach's TSS estimate when one exists.
- Planned sessions come from the stored plan's current and next week. A rest
  day is shown as `Rest` and is not selectable. Planned sessions are hidden on
  past days, and on today when an activity has already been recorded.
- Calendar cards show a planned workout's duration in minutes only; the
  intensity and TSS stay in the detail dialog.
- A block's `startDate` gets a `Block starts · <name>` marker on that day.
- The season's `endDate` gets a `Season ends` marker, and the page heading
  states the season goal.
- Days with nothing to show are omitted by the API and render as empty cells.

### Detail dialog

- Selecting an activity opens a dialog with its name, date and time, type,
  distance, duration, climb, training load, coach analysis, athlete comment,
  coach response, and the route map when at least two route points exist.
- Selecting a planned workout opens a dialog with the date, status, duration,
  intensity, indoor/outdoor setting, training load or estimated TSS, weather
  when the session can be outdoors, and the coach's description.
- The dialog closes on the Close button, clicking the backdrop, or Escape.

## Data model / API impact

Shared (`@killingit/shared`):

- `calendar.ts`: `calendarImportedActivitySchema` (analysed activity plus
  `source: "garmin"`), `calendarManualActivitySchema`, their discriminated
  union `calendarActivitySchema`, `calendarDaySchema`, and
  `calendarResponseSchema` (`earliestDate`, `latestDate`, `season`, `days`).

API:

- `apps/api/src/routes/calendar.ts`: `buildCalendar` (pure) and the route.
- Registered at `/api/calendar` behind `requireAuth`.
- No database migration; the endpoint reads `coach_plans`,
  `activity_feed_cache`, `manual_activities`, and `coach_replies`.

## UI

- The account menu gains `Calendar` after `Fitness`.
- `CalendarPage` fetches the data for the effective today.
- `CalendarView` is presentational: heading, navigation, month grid, legend
  note, and the dialog. `CalendarEntryDialog` is exported separately so it can
  be render-tested.
- `calendarDates.ts` holds the pure UTC month helpers.

## Acceptance criteria

1. `GET /api/calendar` without a bearer token returns 401 and without `today`
   returns 400.
2. The response bounds start at the earliest data we have and end at the
   season end (or today without a season).
3. Imported and manual activities, planned workouts, rest days, block starts,
   and the season end appear on the correct days.
4. Previous/next and the month picker cannot leave the available range.
5. Clicking an activity or planned workout opens a dialog with its full
   details; a recorded outdoor activity includes the route map, comment, and
   coach response.
6. The page is reachable from the account menu.
7. Typecheck, lint, format, and tests pass.

## Testing

- Shared schema tests are covered through the API route and web render tests.
- API route tests: auth, missing date, activity and manual entries, plan
  sessions including a rest day, block starts, season end, and bounds.
- Web unit tests for the month helpers and render tests for the month grid,
  range controls, and both dialog variants.
