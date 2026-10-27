# Spec: Fitness page

- **Status:** Accepted (implemented)
- **Date:** 2026-10-27
- **Related:** `docs/specs/training-load.md`, ADR 0012,
  `docs/specs/dashboard-layout.md`.

## Goal

Give the athlete a single place to see how their fitness (CTL), fatigue (ATL),
and form (TSB) have moved, and how the coach's estimated FTP is progressing.
The numbers and the TSB colours must match the ones already shown on the plan
and activity views.

## Scope

### In scope

1. A new authenticated endpoint that returns the day-by-day training load over
   a window, using the same TSS resolution as the Activities page.
2. A new day-by-day estimated-FTP series for the same window.
3. A `Fitness` page with a fitness/form chart, a coloured TSB zone legend using
   the existing interpretation colours, and an estimated-FTP chart.
4. A hover card on the fitness chart showing the pointed-at day's numbers and
   the activities logged that day.

### Out of scope (deferred)

- Zooming and brushing on the charts.
- Selecting an arbitrary date range in the UI. The API accepts a window length;
  the page always asks for the default.
- Persisting load history beyond the Garmin sync window (42 days) and the
  stored plan.
- Per-sport load or separate running/cycling FTP models.

## Behaviour

### Window

`GET /api/fitness?today=YYYY-MM-DD&days=N`

- `today` is required and must be `YYYY-MM-DD`.
- `days` defaults to 90 and is clamped to 7–365.
- The window starts at `today − (days − 1)` and ends at the later of `today`
  and the last day the stored plan covers, so the projected week is visible.
- Every day in the window is returned, ascending, including rest days.

### Load series

The TSS for a day is resolved exactly as on the Activities page:

1. measured power, using the FTP in effect on that date;
2. the coach's TSS estimate from the stored plan for a day it covers;
3. a manual entry's stored coach estimate for its date (summed per day);
4. a duration-based estimate for an imported activity without power.

The ATL/CTL recurrence is seeded 42 days before the window start (rest days
count as zero), so the chart and the Activities page agree for the same date.
`TSB = CTL − ATL`, as in the plan views.

### Activities per day

Each day carries the activities logged on it, for the chart's hover card:
imported activities with their name, raw type, and moving time in minutes; then
manual entries with the athlete's description and the type `manual`. An activity
without a name falls back to its formatted type, and a missing duration is left
out. Days without activities return an empty list.

### FTP series

For each day, the estimated FTP is:

1. the stored plan's weekly estimate for the week containing that day (the
   current and next week, and each week of the current and next block); or
2. the interpolated athlete timeline value (`ftpAt`), which covers the stated
   profile FTP and every later FTP test the athlete mentioned.

The series is empty when the athlete has never stated an FTP, and the page hides
the FTP chart.

## Data model / API impact

Shared (`@killingit/shared`):

- `fitness.ts`: `fitnessDayActivitySchema` (`id`, `name`, `type`, optional
  `durationMinutes`), `fitnessHistoryDaySchema` (`date`, the existing
  `trainingLoadSchema`, and `activities`), `ftpHistoryPointSchema` (`date`,
  `watts`), and `fitnessHistoryResponseSchema` (`days`, `ftp`).
- `trainingLoad.ts`: `FORM_ZONES`, the TSB bands (`from` inclusive, `to`
  exclusive) used to shade the chart. The band colours stay in the web theme
  (`--form-*`), so they cannot drift from the interpretation text.

API:

- `apps/api/src/training/history.ts` — `buildFitnessHistory` (pure) and
  `loadFitnessHistory` (loads the cached activity feed's FTP context).
- `apps/api/src/training/context.ts` — the FTP timeline, plan TSS, and manual
  TSS shared with `loadUserActivityTrainingLoads`.
- `apps/api/src/routes/fitness.ts` — the endpoint above.
- No database migration.

## UI

- The account menu gains `Fitness` (after `Coach`).
- The page shows today's `TSS · ATL · CTL · TSB · Interpretation` line, a
  fitness/form chart with CTL, ATL, and TSB lines over coloured TSB zone bands,
  a legend naming each zone with its threshold and colour, and an estimated-FTP
  step chart.
- Only the plot itself is white, so the zone tints stay clean while the rest of
  the chart keeps the card's surface. The bands are soft tints (62.5%) of the
  zone colours, and the TSB line is solid and coloured by the zone it is in
  (`--form-*-line`, the zone colours darkened towards black), so line and band
  stay distinct. The line changes colour where it crosses a zone boundary, not
  once per day, so a day that dips out of a zone is drawn partly in each colour.
  CTL and ATL use the chart ink tokens (`--chart-ink`, `--chart-ink-muted`).
- The zone legend sits on one line above the CTL/ATL/TSB legend. Both align
  with the plot's left edge rather than the axis gutter, and the main content
  panel is wider (`max-w-5xl`) so the zone legend fits on one line.
- Pointing at (or tapping) either chart marks the nearest day with a guide line
  and shows a card with the date, the load numbers and interpretation, and the
  activities logged that day. The FTP chart's card also shows that day's
  estimated FTP. The charts are tall enough for the card to sit over the top of
  the plot without hiding the lines below it.
- The charts are static SVG (no new dependency), scale with the page width, and
  carry an accessible title.
- Loading, error, and (when there is no planned or recorded training) empty
  states are shown.

## Acceptance criteria

1. `GET /api/fitness` without a bearer token returns 401 and without `today`
   returns 400.
2. The response has one day per calendar day in the window, ascending, and each
   day's TSB equals its CTL minus ATL.
3. A day's TSS comes from measured power, then the coach estimate, then the
   manual entry, matching the Activities page.
4. The TSB zone bands and the legend use the same colours as the interpretation
   text (`--form-risk`, `--form-productive`, …), and the TSB line is solid and
   changes colour exactly where it crosses from one zone into the next.
5. The FTP chart plots the coach's weekly estimate inside the stored block and
   the athlete's stated/tested values elsewhere, and is hidden without an FTP.
6. Pointing at a day of either chart shows that day's numbers and the
   activities logged on it, if any; the FTP chart also shows that day's FTP.
7. The page is reachable from the account menu and renders today's load line.
8. Typecheck, lint, format, and tests pass.

## Testing

- Shared: no new schema behaviour beyond the existing training-load tests;
  `FORM_ZONES` is exercised through the web chart tests.
- API unit tests for `buildFitnessHistory`: continuous days, TSS precedence,
  manual entries, plan TSS, FTP weekly estimate vs. timeline, no FTP, and the
  activities listed per day.
- API route tests: auth, missing date, day clamping, and the happy path.
- Web unit tests for the chart scale helpers, a render test for the page view
  (load line, zone legend, both charts, hidden FTP chart), and a render test for
  the hover card.
