# Spec: Body metrics and time-series storage

- **Status:** Accepted (implemented)
- **Date:** 2026-10-28
- **Related:** `docs/specs/fitness-page.md`, `docs/specs/training-load.md`,
  ADR 0012.

## Goal

Store FTP, body weight, and body-fat percentage as daily time series so the
coach and the Fitness page reason from the same history. Body weight and body
fat come from Garmin; FTP comes from the athlete and from coach estimates. The
Fitness page charts body weight and body fat when the athlete has measurements,
interpolating between known values and projecting a best-fit trend across the
days that the stored plan covers.

## Scope

### In scope

1. A new `athlete_metrics` table with one value per user, metric, and calendar
   day.
2. A source column distinguishing athlete-provided (`user`), Garmin-synced
   (`garmin`), and coach-estimated (`coach`) values.
3. A Garmin sidecar `/metrics` endpoint and API sync for body weight, body-fat
   percentage, and historic cycling FTP.
4. Seeding the FTP series from the profile and dated athlete text that the
   coach reads, so existing accounts keep working.
5. Persisting every weekly FTP estimate from plan generation and every
   structured FTP estimate returned by an activity analysis.
6. Including the FTP history in plan and activity-analysis prompts.
7. A body chart on the Fitness page with interpolation between measurements and
   a best-fit projection after the last measurement.
8. Capturing the body weight and body-fat percentage the coach finds in the
   athlete's input, on the dates it refers to, so the body chart has data before
   Garmin is connected.

### Out of scope (deferred)

- Manual body-weight or body-fat entry in the UI. Garmin is the measurement
  source; an explicit entry form can be added later without a schema change.
- Syncing Garmin's FTP for sports other than cycling, or other
  body-composition fields.
- A custom date range on the Fitness page.

## Data model

`athlete_metrics`:

| Column       | Type                                           |
| ------------ | ---------------------------------------------- |
| `id`         | serial primary key                             |
| `user_id`    | account reference, cascade delete              |
| `metric`     | `ftp`, `weight`, or `body_fat`                 |
| `source`     | `user`, `garmin`, or `coach`                   |
| `date`       | `YYYY-MM-DD`                                   |
| `value`      | double precision; watts, kilograms, or percent |
| `created_at` | timestamp with time zone                       |
| `updated_at` | timestamp with time zone                       |

A unique index on `(user_id, metric, date)` keeps one value per day. A `user` or
`garmin` value replaces a coach estimate for the same day. When the coach
returns a newer FTP estimate at date D, every coach FTP point after D is deleted;
athlete measurements are never deleted.

## Behaviour

### Garmin sync

- The sidecar's `POST /metrics` logs in with the same token store as `/sync` and
  calls `get_body_composition` and `get_functional_threshold_power_range` over
  the same 42-day window.
- Each weigh-in is normalized to `{ date, weightKg?, bodyFatPercent? }`.
  Weights reported in pounds or grams are converted to kilograms; a
  body-fat value below 1 is treated as a fraction and converted to percent.
  Samples without a usable date or value are skipped.
- The historic cycling FTP is normalized to `{ date, watts }` from Garmin's
  `functionalThresholdPower` records. A failed FTP fetch leaves the body
  measurements intact.
- The API stores body values with source `garmin`; FTP samples are also stored
  with source `garmin` so a newer coach estimate never deletes them. A failed
  metrics sync is logged and never fails the activity feed.
- `GET /api/garmin/activities` and the activity feed both refresh metrics.

### FTP series

- The coach reads the athlete's free-text FTP, weight, and body-fat statements
  and they are stored as `user` points before plan generation. A profile value
  with no date is dated by the profile's last save.
- The plan's weekly `estimatedFtpWatts` values are stored as `coach` points on
  the week's start date after the plan is saved. Activity and program analyses
  return `{ "analysis": string, "estimatedFtpWatts": number | null }`; a non-null
  estimate is stored as a `coach` point on the activity's date.
- Estimates are applied oldest first, so a slow older LLM response cannot
  delete a newer estimate. Plan estimates are applied after program reviews for
  the same reason.
- Training load and plan prompts use the timeline through today; future coach
  projections are not treated as the current baseline.
- Prompts receive the most recent 60 FTP points, oldest first, with their
  source.

### Coach-read body metrics

Body weight and body fat are never pattern-matched out of the athlete's text.
The coach reads them from the athlete's own words:

- A dedicated call (`kind: athlete_metrics`) sends the profile and every dated
  piece of athlete text — comments, manual activities, weekly notes, and review
  comments — and returns one dated statement per page of text with
  `ftpWatts`, `weightKg`, and `bodyFatPercent` (null when not stated). It runs
  before every plan generation, which the app only starts when a level is
  missing or an input changed.
- The coach reports only numbers the athlete states about themselves; a goal
  ("down to 15 %") is not a measurement. Weight is kilograms (pounds are
  converted) and body fat is a percentage of body weight (a fraction such as
  0.245 becomes 24.5).
- A number in the profile with no date of its own is dated by the profile's last
  save; every other statement is dated by the day the athlete wrote it. Values
  dated after today are ignored, and the newest value for a date wins.
- These statements are the athlete's own words, so they are stored as `user`
  points. A `user` value replaces a Garmin measurement on the same day, and a
  coach estimate never replaces either.
- A successful read reports everything the athlete has ever stated, so it
  replaces the `user` points of every metric it reported. A value the athlete
  edits out of a comment therefore disappears, and a reading produced by an
  older implementation does not linger. Garmin measurements, coach estimates,
  and any metric the read says nothing about are left alone.
- A plan response additionally carries a `bodyMetrics` array of
  `{ date, weightKg, bodyFatPercent }` points and an activity analysis carries
  `weightKg` and `bodyFatPercent`, so the coach can still report a value it
  finds in context. These are stored as `coach` points and never replace a
  `user` or `garmin` value.
- A plan prompt receives the stored weight and body-fat history, so the coach
  does not repeat a value it has already reported.
- Unlike FTP estimates, a newer body point does not delete later ones: body
  measurements are not a projection that a fresher estimate supersedes.
- Storing is fail-open: a failed read or write is logged and never fails the
  plan or the activity analysis.

### Fitness page

`GET /api/fitness` gains `body: { weight, bodyFat }`, each an array of
`{ date, value }` daily points.

- The series starts at the first measurement and ends at the chart window's end,
  which already extends to the last planned workout day.
- Values between measurements are linearly interpolated.
- After the last measurement, the series continues with the least-squares
  slope through all known points, anchored at the last measured value. With one
  point the projection is flat.
- The chart draws weight on the left axis in kilograms and body fat on the right
  axis in percent, with a shared date axis. The part after today is dotted. The
  chart is hidden when both series are empty, and shows only the available line
  when one metric has no data.

## API impact

- `GET /api/fitness` response adds the optional-with-default `body` object.
- Garmin sidecar `POST /metrics`.
- Plan response schemas gain `bodyMetrics` (default `[]`), and
  `coachPlanSchema` carries it as an optional array. `coachAnalysisResultSchema`
  gains `weightKg` and `bodyFatPercent` (nullable, default `null`).
- `athleteMetricStatementSchema` (shared) describes one dated statement with
  `ftpWatts`, `weightKg`, and `bodyFatPercent`; `athleteMetricsResultSchema`
  wraps the list.
- The plan and activity-analysis prompts ask for those fields and receive the
  stored body history; the prompt versions are bumped. The dedicated
  `athlete_metrics` prompt has its own version.
- No public route changes.

## Acceptance criteria

1. Applying the migration creates `athlete_metrics` with the metric/source
   checks and the per-day unique index.
2. A Garmin weigh-in with weight and body fat is stored once per day and shown
   on the Fitness page.
3. A coach FTP estimate at date D removes coach estimates after D but keeps
   every `user` and `garmin` value.
4. The plan prompt, activity-analysis prompt, and program-review prompt include
   FTP history.
5. Body weight and body fat are interpolated between known dates and projected
   with a best-fit trend after the last known date, through the plan end.
6. The body chart is hidden without measurements and omits a line whose metric
   has no data.
7. A profile that states "89,5 kg and 24,5 % body fat" produces a `user` weight
   and body-fat point on the profile's last save date, and the Fitness page
   draws both lines.
8. A weigh-in the athlete mentions in an activity comment is stored on the
   activity's date as a `user` point, and a later Garmin value on that day is
   not overwritten.
9. Typecheck, lint, format, unit tests, and the Garmin sidecar tests pass.

## Testing

- Shared unit tests for interpolation, best-fit slope, and projection.
- API unit tests for the timeline built from stored points, reference-date
  filtering, and user-over-coach precedence.
- Prompt tests for the `athlete_metrics` contract and the dated text it sends.
- Reading tests for the storage, one-value-per-date merge, future-date filtering,
  and the fail-open paths.
- History tests for interpolated body series and the empty case.
- Garmin sidecar tests for body-composition normalization, unit conversion, and
  the metrics sync.
- Web tests for the chart's presence, lines, and hidden states.
