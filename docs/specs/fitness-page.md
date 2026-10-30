# Spec: Fitness page

- **Status:** Accepted (implemented)
- **Date:** 2026-10-27
- **Related:** `docs/specs/training-load.md`, ADR 0012,
  `docs/specs/dashboard-layout.md`.

## Goal

Give the athlete a single place to see how their fitness (CTL), fatigue (ATL),
and form (TSB) have moved, how the coach's estimated FTP is progressing, and
how body weight and body-fat percentage are trending. The numbers and the TSB
colours must match the ones already shown on the plan and activity views.

## Scope

### In scope

1. A new authenticated endpoint that returns the day-by-day training load over
   a window, using the same TSS resolution as the Activities page.
2. A new day-by-day estimated-FTP series for the same window.
3. A `Fitness` page with a fitness/form chart, a coloured TSB zone legend using
   the existing interpretation colours, an estimated-FTP chart, and a body
   weight/body-fat chart when measurements exist.
4. A hover card on either load chart showing the pointed-at day's numbers, the
   activities logged that day, or the planned workout when none was logged.
5. A range picker (Week, Month, Quarter, Year, All time) above the charts.

### Out of scope (deferred)

- Zooming and brushing on the charts.
- A custom date range. The API accepts the five named ranges only.
- Persisting load history beyond the Garmin sync window (42 days) and the
  stored plan.
- Per-sport load or separate running/cycling FTP models.

## Behaviour

### Window

`GET /api/fitness?today=YYYY-MM-DD&range=week|month|quarter|year|all`

- `today` is required and must be `YYYY-MM-DD`.
- `range` defaults to `month`; anything else is a 400.
- The window starts `week` (7), `month` (30), `quarter` (90), or `year` (365)
  days back, or at the first recorded or manually entered activity for `all`
  (falling back to the past week when nothing has been logged).
- The window ends at the later of today and the stored plan's last day, so the
  chart runs exactly as far ahead as there are planned workouts. Days after
  today are that projection: they follow the stored plan's sessions and count
  as rest once the plan runs out.
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

### Planned workouts

Each day also carries the stored plan's session for that date, when the plan
covers it: the workout title, whether it is a workout or a rest day, and its
length in minutes. The hover card shows the planned workout when the athlete
has not logged anything that day. A rest day that is still ahead reads
"Planned: Rest"; once it has arrived or passed it reads simply "Rest".

### FTP series

For each day before today, the estimated FTP is the interpolated athlete
timeline value (`ftpAt`), which covers the stated profile FTP, every later FTP
test the athlete mentioned, and recorded history. From today onward the series
is the plan's projection, interpolated rather than stepped:

1. the coach's per-day estimate for each fully detailed session;
2. the weekly estimates of the current and next week and of every week of the
   current and next block, anchored at their week's start; and
3. today's current estimate, which anchors the start of the projection.

The line therefore climbs from the current estimate toward the next weekly
estimate across the week, so a week whose estimate rises from 220 W to 222 W
shows the days in between on the way to 222 W instead of holding 220 W until
the next week starts.

The series is empty when the athlete has never stated an FTP, and the page hides
the FTP chart. The plan's per-session estimates are stored as `coach` points in
`athlete_metrics` when the plan is saved, so the projection survives the plan's
JSON shape and feeds the prompts as FTP history.

### Body series

The response carries `body.weight` and `body.bodyFat`, each a daily
`{ date, value }` series.

1. Values between measurements are linearly interpolated. The series starts at
   the first known measurement.
2. After the last measurement the line continues with the least-squares slope
   through every known point, anchored at the last measured value. With one
   point the projection is flat.
3. The series ends with the chart window, which already extends to the stored
   plan's last planned session.
4. A metric with no measurements produces an empty series. The page hides the
   whole body chart when both are empty, and draws only the available line when
   one is empty.

## Data model / API impact

Shared (`@killingit/shared`):

- `fitness.ts`: `fitnessRangeSchema` and its labels, `fitnessDayActivitySchema`
  (`id`, `name`, `type`, optional `durationMinutes`), `fitnessDayPlanSchema`
  (`title`, `type`, `durationMinutes`), `fitnessHistoryDaySchema` (`date`, the
  existing `trainingLoadSchema`, `activities`, and `planned`),
  `ftpHistoryPointSchema` (`date`, `watts`),
  `fitnessMetricPointSchema` (`date`, `value`), `fitnessBodySchema`
  (`weight`, `bodyFat`), and `fitnessHistoryResponseSchema` (`days`, `ftp`,
  `body`). `metrics.ts` also holds the interpolation and best-fit helpers.
- `trainingLoad.ts`: `FORM_ZONES`, the TSB bands (`from` inclusive, `to`
  exclusive) used to shade the chart. The band colours stay in the web theme
  (`--form-*`), so they cannot drift from the interpretation text.

API:

- `apps/api/src/training/history.ts` — `buildFitnessHistory` (pure) and
  `loadFitnessHistory` (loads the cached activity feed's FTP context and body
  metric series).
- `apps/api/src/metrics/store.ts` — the `athlete_metrics` time-series reads and
  writes, including the coach-estimate replacement rule.
- `apps/api/src/training/context.ts` — the FTP timeline, plan TSS, and manual
  TSS shared with `loadUserActivityTrainingLoads`.
- `apps/api/src/routes/fitness.ts` — the endpoint above.
- Migration `0026_ancient_deathbird.sql` adds `athlete_metrics`.

## UI

- The account menu gains `Fitness` (after `Coach`).
- A range picker (`Show: Week | Month | Quarter | Year | All time`) sits above
  the charts, aligned to the right, and refetches the history. The Today panel stays on the current
  day whatever the range.
- The page shows a Today panel: `Training stress · Fatigue · Fitness · Form`
  with each acronym beside the spelled-out name and the interpretation in its
  zone colour, one size larger than the compact line used on the plan and
  activity views. The panel also shows the estimated FTP in effect today.
- Below it, a fitness/form chart with CTL, ATL, and TSB lines over coloured TSB
  zone bands, a legend naming each zone with its threshold and colour, an
  estimated-FTP line chart whose heading carries no value (the current estimate
  is in the Today panel), and a body chart when body measurements exist.
- The body chart draws weight on the left axis in kilograms and body fat on the
  right axis in percent over the same date axis, with a legend for each
  available line. The part after today is dotted, like the other projections.
  Pointing at it shows the date and the available measurements.
- Only the fitness chart's plot is white, so the zone tints stay clean while the
  rest of that chart — and the whole FTP chart — keeps the card's surface. The bands are soft tints (62.5%) of the
  zone colours, and the TSB line is solid and coloured by the zone it is in
  (`--form-*-line`, the zone colours darkened towards black), so line and band
  stay distinct. The line changes colour where it crosses a zone boundary, not
  once per day, so a day that dips out of a zone is drawn partly in each colour.
  CTL and ATL use the chart ink tokens (`--chart-ink`, `--chart-ink-muted`).
- The zone legend sits on one line above the CTL/ATL/TSB legend. Both align
  with the plot's left edge rather than the axis gutter, and the main content
  panel is wider (`max-w-5xl`) so the zone legend fits on one line.
- The part of every line after today is dotted, marking it as the projection.
- Pointing at (or tapping) either chart marks the nearest day with a guide line
  and a marker on the CTL line, and shows a card with the date, the load
  numbers and interpretation, and the activities logged that day — or the
  planned workout when nothing was logged. The FTP chart's card also shows that
  day's estimated FTP. The charts are tall enough
  for the card to sit over the top of the plot without hiding the lines below
  it.
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
5. The FTP chart plots the plan's projection from today onward as a line
   interpolated between the coach's daily estimates and the weekly estimates,
   and the athlete's stated/tested values for recorded history, and is hidden
   without an FTP.
6. The charts run as far ahead as the stored plan has workouts, and the part
   after today is dotted.
7. The Today panel spells out training stress, fatigue, fitness, and form
   beside their acronyms, reads larger than the compact plan/activity line, and
   shows today's estimated FTP.
8. Pointing at a day of either chart shows that day's numbers and the
   activities logged on it, or the planned workout when none was (a future
   rest day reads "Planned: Rest", today's or a past one just "Rest"); the FTP
   chart also shows that day's FTP.
9. The range picker switches between the five windows, and `All time` starts at
   the first recorded or manual activity.
10. The page is reachable from the account menu and renders today's load line.
11. Body weight and body fat are interpolated between measurements and projected
    with a best-fit trend after the last measurement, through the plan's last
    day. The chart is hidden without measurements, and a metric without data
    does not draw a line.
12. Typecheck, lint, format, and tests pass.

## Testing

- Shared: no new schema behaviour beyond the existing training-load tests;
  `FORM_ZONES` is exercised through the web chart tests.
- API unit tests for `buildFitnessHistory`: continuous days, TSS precedence,
  manual entries, plan TSS, daily plan estimate vs. interpolated week estimate
  vs. timeline, no FTP, the activities listed per day, and the interpolated body
  series.
- API route tests: auth, missing date, day clamping, and the happy path.
- Web unit tests for the chart scale helpers, a render test for the page view
  (load line, zone legend, both charts, hidden FTP chart, body chart and its
  hidden states), and a render test for the hover card.
