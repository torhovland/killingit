# Spec: Fitness page

- **Status:** Accepted (implemented)
- **Date:** 2026-10-27
- **Related:** `docs/specs/training-load.md`, ADR 0012,
  `docs/specs/dashboard-layout.md`, `docs/specs/threshold-metrics.md`.

> Thresholds are now per sport and the FTP chart has become the **Estimated
> threshold** chart, with one line per measure. The FTP-specific projection
> below still describes how the cycling FTP line is built; see
> `docs/specs/threshold-metrics.md` and ADR 0015 for the generic model.

## Goal

Give the athlete a single place to see how their fitness (CTL), fatigue (ATL),
and form (TSB) have moved, how their estimated thresholds are progressing, and
how body weight and body-fat percentage are trending. The numbers and the TSB
colours must match the ones already shown on the plan and activity views.

## Scope

### In scope

1. A new authenticated endpoint that returns the day-by-day training load over
   a window, using the same TSS resolution as the Activities page.
2. A new day-by-day estimated-threshold series for the same window, with one
   line per stored measure.
3. A `Fitness` page with a fitness/form chart, a coloured TSB zone legend using
   the existing interpretation colours, an estimated-threshold chart, a body
   weight/body-fat chart when measurements exist, and recovery/sleep charts
   when Garmin has recorded those measures.
4. A hover card on either load chart showing the pointed-at day's numbers, the
   activities logged that day, or the planned workout when none was logged.
5. A range picker (Week, Month, Quarter, Year, All time) above the charts.
6. The Today panel's newest-Garmin readings in two columns: a general column
   and a Sleep column, with recovery and sleep charts below the body chart.

### Out of scope (deferred)

- Zooming and brushing on the charts.
- A custom date range. The API accepts the five named ranges only.
- Separate ATL/CTL curves per sport: each activity is scored with the threshold
  for its own sport, but the load series is a single aggregate curve.

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

The series is not limited to Garmin's 42-day sync window: the activity store
keeps every activity ever synced, so an activity that leaves the window still
contributes its TSS to the chart and its seeding. See
`docs/specs/activity-store.md`.

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

### Estimated threshold series

Every stored threshold measure gets its own line in the estimated-threshold
chart. For the cycling FTP line, each day before today is the interpolated
athlete timeline value, built from the stored threshold points; it covers the
stated profile FTP, every later FTP test the athlete mentioned, and Garmin's
recorded history. From today onward the FTP line is the plan's projection,
interpolated rather than stepped:

1. the coach's per-day estimate for each fully detailed session;
2. the weekly estimates of the current and next week and of every week of the
   current and next block, anchored at their week's start; and
3. today's current estimate, which anchors the start of the projection.

The line therefore climbs from the current estimate toward the next weekly
estimate across the week, so a week whose estimate rises from 220 W to 222 W
shows the days in between on the way to 222 W instead of holding 220 W until
the next week starts.

The other measures keep their measured, interpolated trend and get no
projection. A measure with no stored points gets no series; when no threshold
is stored at all, the page hides the estimated-threshold chart. The plan's
per-session estimates are stored as `coach` points in `athlete_thresholds` when
the plan is saved, so the projection survives the plan's JSON shape and feeds
the prompts as threshold history.

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
5. The response also carries `seasonEndDate` and `dietTargets`, the coach's
   expected body composition at each plan period end. The body chart offers a
   season view that extends its own x-axis from the window's last day to the
   season end and draws those targets as a dotted line with markers. The line
   starts at today's chart value and joins every future target; it is hidden
   unless the athlete selects the view. See
   `docs/specs/diet-progress-targets.md`.

## Data model / API impact

Shared (`@killingit/shared`):

- `fitness.ts`: `fitnessRangeSchema` and its labels, `fitnessDayActivitySchema`
  (`id`, `name`, `type`, optional `durationMinutes`), `fitnessDayPlanSchema`
  (`title`, `type`, `durationMinutes`), `fitnessHistoryDaySchema` (`date`, the
  existing `trainingLoadSchema`, `activities`, and `planned`),
  `thresholdHistorySeriesSchema` (`sport`, `measure`, `label`, `unit`, `kind`,
  and one point per day), `fitnessMetricPointSchema` (`date`, `value`),
  `fitnessBodySchema` (`weight`, `bodyFat`), `latestGarminSchema` (`dailyHealth`,
  `weight`, `bodyFat`, `ftp`), `fitnessDietTargetSchema` (`date`, `weightKg`,
  `bodyFatPercent`), and `fitnessHistoryResponseSchema` (`days`, `thresholds`,
  `body`, `latestGarmin`, `dailyHealth`, `nutrition`, `seasonEndDate`,
  `dietTargets`). `metrics.ts` also holds the interpolation and best-fit
  helpers.
- `trainingLoad.ts`: `FORM_ZONES`, the TSB bands (`from` inclusive, `to`
  exclusive) used to shade the chart. The band colours stay in the web theme
  (`--form-*`), so they cannot drift from the interpretation text. The load
  maths that fills the chart lives in `apps/api/src/training/stress.ts`; see
  `docs/specs/shared-api-boundary.md`.

API:

- `apps/api/src/training/history.ts` — `buildFitnessHistory` (pure and
  module-internal) and the exported `loadFitnessHistory` (loads the threshold
  context, body metric series, daily health and nutrition inputs).
- `apps/api/src/metrics/store.ts` — the `athlete_metrics` and
  `athlete_thresholds` time-series reads and writes, including the
  coach-estimate replacement rule.
- `apps/api/src/training/context.ts` — the threshold timelines, plan TSS, and
  manual TSS shared with `loadUserActivityTrainingLoads`.
- `apps/api/src/routes/fitness.ts` — the endpoint above.
- Migration `0026_ancient_deathbird.sql` adds `athlete_metrics`, and migration
  `0032_slimy_warhawk.sql` adds `athlete_thresholds`.

## UI

- The account menu gains `Fitness` (after `Coach`).
- A range picker (`Show: Week | Month | Quarter | Year | All time`) sits above
  the charts, aligned to the right, and refetches the history. The Today panel stays on the current
  day whatever the range.
- The page shows a Today panel: `Training stress · Fatigue · Fitness · Form`
  with each acronym beside the spelled-out name and the interpretation in its
  zone colour, one size larger than the compact line used on the plan and
  activity views. The panel also shows the estimated FTP in effect today. It
  also shows the newest Garmin readings in two columns. The
  left column lists resting heart rate, HRV, Body Battery high, Body Battery
  low, stress, steps, intensity minutes, active calories, respiration, SpO2,
  training readiness, recovery time, VO2max and cycling VO2max, as well as the
  newest Garmin weight, body-fat and FTP measurement. The right column is headed
  `Sleep` and lists sleep score, sleep duration, deep sleep, REM sleep, light
  sleep and awake time. Each row carries its measurement date, and a value
  measured today says "today". Body Battery high and low are running values for
  today, so those rows use the last completed day until today is over. Metrics
  without a stored value are omitted.
- Below it, a fitness/form chart with CTL, ATL, and TSB lines over coloured TSB
  zone bands, a legend naming each zone with its threshold and colour, an
  estimated-threshold chart whose heading carries no value (the current
  estimates are in the Today panel), and a body chart when body measurements
  exist.
- The estimated threshold is grouped by unit, and every unit gets its own
  bordered panel below the shared `Estimated threshold` heading, which sits
  outside the panels. The legend names each measure, its sport, and its latest
  value with its unit.
- Every y axis shows plain numbers: the unit is in the legend instead, so the
  axis gutter has room for the values themselves.
- The body chart draws weight on the left axis and body fat on the right axis
  over the same date axis, with a legend for each available line carrying its
  unit. The part after today is dotted, like the other projections. Pointing at
  it shows the date and the available measurements. Its axis labels use the same
  size as the other charts. A checkbox extends the chart to the season end and
  draws the coach's diet progress targets as a dotted line with markers and a
  legend entry, when diet advice is on and a goal was stated; see
  `docs/specs/diet-progress-targets.md`.
- Below the body chart, a `Recovery and sleep` section draws a resting heart
  rate chart, a score chart with Body Battery high, sleep score and stress, and
  a stacked sleep-stage chart whose deep, light and REM areas add up to sleep
  duration. The sleep legend shows the latest value of each stage and the
  hovered day's awake time. Each chart hides itself when Garmin has not
  recorded its measures.
- Between the body chart and the recovery charts, a `Calories` chart draws the
  calories logged per day as bars and the coach's estimated daily requirement as
  a line. It is hidden when there is no logged meal or stored target in the
  window. A day without an analysed meal has no bar, and a day without a target
  breaks the line; see `docs/specs/diet-coaching.md`.
- Only the fitness chart's plot is white, so the zone tints stay clean while the
  rest of that chart — and the whole estimated-threshold chart — keeps the
  card's surface. The bands are soft tints (62.5%) of the
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
  planned workout when nothing was logged. The estimated-threshold chart's card
  also shows that day's values. The charts are tall enough
  for the card to sit over the top of the plot without hiding the lines below
  it.
- Every chart is one keyboard stop as well: the left and right arrow keys move
  the same marker and card through the days, Home and End jump to the first and
  last day, and Escape or leaving the chart clears them. A polite live region
  reads the moved-to day's card, and the chart's hidden description names the
  keys. The keyboard never announces pointer movement. See
  `docs/specs/chart-keyboard-navigation.md` and ADR 0051.
- Every fitness chart shares `ChartFrame` (`apps/web/src/charts/ChartFrame.tsx`): it
  owns the card, the accessible SVG, the y and x axes, the hovered-day guide and
  the hover card's placement, and the keyboard cursor with its live region. A
  chart supplies its scale, ticks, legend and a
  render-prop that draws its series inside the plot, so the line charts, the
  stacked sleep chart and the calorie bars use the same frame. A chart can add a
  footer, and the body chart adds a right axis.
- Every chart path is built by `chartPath` in
  `apps/web/src/charts/chartGeometry.ts`, which owns the `M`/`L` assembly and the one
  coordinate rounding (`roundChartValue`). A chart supplies points with a day
  index and a value; `linePath` and `nullAwarePath` shape a value array, and
  `datedPathPoints` shapes a dated series for the body chart, whose sparse diet
  targets are joined across instead of broken. A null value starts a new
  subpath. See ADR 0049.
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
5. The estimated-threshold chart plots the plan's cycling FTP projection from
   today onward as a line interpolated between the coach's daily estimates and
   the weekly estimates, and the athlete's stated/tested values for recorded
   history; the chart is hidden without a threshold.
6. The charts run as far ahead as the stored plan has workouts, and the part
   after today is dotted.
7. The Today panel spells out training stress, fatigue, fitness, and form
   beside their acronyms, reads larger than the compact plan/activity line, and
   shows today's estimated FTP.
8. Pointing at a day of either chart shows that day's numbers and the
   activities logged on it, or the planned workout when none was (a future
   rest day reads "Planned: Rest", today's or a past one just "Rest"); the FTP
   chart also shows that day's FTP. The keyboard reaches the same days, and a
   polite live region reads them.
9. The range picker switches between the five windows, and `All time` starts at
   the first recorded or manual activity.
10. The page is reachable from the account menu and renders today's load line.
11. Body weight and body fat are interpolated between measurements and projected
    with a best-fit trend after the last measurement, through the plan's last
    day. The chart is hidden without measurements, and a metric without data
    does not draw a line.
12. The Today panel lists the newest Garmin daily health metric per measure in
    two columns: a general column and a `Sleep` column. The general column
    includes Body Battery low and the newest Garmin weight, body-fat and FTP
    measurement. Recovery and sleep charts draw resting heart rate, Body Battery
    high, sleep score, stress and the stacked sleep stages, each with a hover
    card.
13. Typecheck, lint, format, and tests pass.
14. The calorie chart sits below the body chart, draws a bar for each day's
    analysed meals and a line for the coach's required calories, and is hidden
    when neither exists. See `docs/specs/diet-coaching.md`.

## Testing

- Shared: no new schema behaviour beyond the existing training-load tests;
  `FORM_ZONES` is exercised through the web chart tests.
- API unit tests for `loadFitnessHistory`: continuous days, TSS precedence,
  manual entries, plan TSS, daily plan estimate vs. interpolated week estimate
  vs. timeline, no threshold, the activities listed per day, the interpolated
  body series, and the latest Garmin readings.
- API route tests: auth, missing date, day clamping, and the happy path.
- Web unit tests for the chart scale helpers and the shared chart frame
  (caption, left and right axes, date labels, render-prop series, legend and
  footer, and the keyboard stop with its announcement), the one path builder (a
  line, a gap, a skipped day and the coordinate rounding), a render test for the
  page view (load line, zone legend, both charts, hidden threshold chart, body
  chart and its hidden states, the Garmin Today columns and the recovery/sleep
  charts), a render test for the hover card, and the shared keyboard cursor's
  interaction tests (`useChartHover.test.tsx`, `FitnessChart.test.tsx`, and
  `CostBarChart.test.tsx` for the Costs page chart). See
  `docs/specs/chart-keyboard-navigation.md`.
