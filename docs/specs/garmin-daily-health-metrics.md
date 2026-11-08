# Spec: Garmin daily health and recovery metrics

- **Status:** Proposed
- **Date:** 2026-11-02
- **Related:** `docs/specs/garmin-activity-integration.md`,
  `docs/specs/training-load.md`, `docs/specs/coach-plan-prompts.md`,
  `docs/specs/coach-reply-context.md`, ADR 0003.

## Goal

Sync Garmin's daily health, sleep and recovery data, store it as a dated time
series, and give every coaching prompt a small curated summary of the athlete's
recent recovery.

## Why

The coach currently sees training load, activities and body composition, but
not how well the athlete slept, how recovered they are, or whether HRV and
resting heart rate are trending badly. Those are the signals that should make
the coach ease a hard session or reassure the athlete that they are ready.

Garmin's daily bundle (`get_stats`) covers resting heart rate, sleep duration,
stress, Body Battery, steps, calories and intensity minutes. On its own it is
missing the parts that matter most for recovery: sleep score and stages,
overnight HRV, SpO2, respiration, training readiness and recovery time, and
VO2max. The sidecar supplements the bundle with `get_sleep_data`,
`get_training_readiness` and `get_max_metrics`. Body composition and FTP stay
on their existing range sync so no weigh-in or FTP request is duplicated.

Still deliberately out of scope: intraday HR/stress/Body Battery arrays, Garmin
HRV status bands and baselines, training status/load balance (the app computes
its own ATL/CTL/TSB), fitness age, hydration/nutrition, blood pressure and
menstrual data.

## Scope

### In scope

1. New sidecar `POST /daily` endpoint: credentials plus one `date` returns that
   day's normalized metrics. Partial upstream failures omit the affected
   metrics; a `429` is surfaced as `429`.
2. New API sync pass that runs **after** the activity sync and walks backwards
   from today, refreshing today and yesterday and fetching every date without a
   per-day watermark, until it reaches the 42-day floor or a `429`.
3. Per-day watermarks stored in `garmin_daily_sync`. A date is marked only
   after its metrics are stored, so a `429` leaves the remaining dates to be
   retried on the next visit.
4. Dated metric values stored in `athlete_daily_metrics`.
5. A curated `formatDailyHealthContext` summary (latest value, 7-day average,
   and change from the previous week, for the last 14 days) added to the plan,
   reply, period-review and activity-analysis prompts.
6. The summary is filtered to the date being discussed: an activity analysis
   only sees recovery data up to that activity's date.
7. The Fitness page's Today panel lists the newest value of every stored daily
   metric in two columns: a general column and a `Sleep` column. Below the body
   chart, a `Recovery and sleep` section charts resting heart rate, Body
   Battery high, sleep score and stress, and a stacked sleep-stage chart whose
   deep, light and REM areas add up to sleep duration.

### Out of scope

- Syncing the omitted metrics listed above.
- Deriving Garmin's proprietary training status; the app keeps its own load
  model.

## Data model

`athlete_daily_metrics`:

| Column       | Type              | Notes                                     |
| ------------ | ----------------- | ----------------------------------------- |
| `id`         | serial            | Primary key                               |
| `user_id`    | integer           | FK to `users`, cascade delete             |
| `metric`     | text              | Stable key from the shared metric catalog |
| `date`       | text `YYYY-MM-DD` | Calendar date                             |
| `value`      | double precision  | Numeric value in the catalog's unit       |
| `source`     | text              | `garmin` for now                          |
| `created_at` | timestamptz       |                                           |
| `updated_at` | timestamptz       |                                           |

Unique on `(user_id, metric, date)`.

`garmin_daily_sync`:

| Column      | Type              | Notes                           |
| ----------- | ----------------- | ------------------------------- |
| `user_id`   | integer           | FK to `users`, cascade delete   |
| `date`      | text `YYYY-MM-DD` | The day whose bundle was stored |
| `synced_at` | timestamptz       | When the watermark was written  |

Primary key `(user_id, date)`.

## Metric catalog

`resting_heart_rate` (bpm), `sleep_duration` (min), `sleep_score`,
`deep_sleep` (min), `light_sleep` (min), `rem_sleep` (min), `awake_sleep`
(min), `hrv` (ms), `spo2` (%), `respiration` (breaths/min), `stress`,
`body_battery_high`, `body_battery_low`, `steps`, `active_calories` (kcal),
`intensity_minutes` (min), `training_readiness`, `recovery_time` (min),
`vo2max` and `vo2max_cycling` (ml/kg/min).

The shared catalog also carries the display label, unit and decimal precision,
so the prompt formatter and any future UI agree.

## Weigh-ins and FTP

Weigh-ins and FTP are not duplicated in `athlete_daily_metrics`. They already
have the right typed stores from the earlier Garmin integration:

- Garmin weigh-ins and body-fat readings go to `athlete_metrics` through the
  existing `/metrics` range sync.
- Garmin's historic cycling FTP goes to `athlete_thresholds` as a `garmin`
  cycling power measurement.

Both supplement what the athlete provides. A `user` value for the same metric
and date wins, a Garmin measurement replaces a coach estimate, and a newer coach
estimate never replaces either a `user` or a Garmin measurement. The same
precedence helper backs the metric and threshold writes (`shouldRecordSource`).

The activity analysis now receives the stored body history as well as the FTP
history, so a workout review sees a Garmin weigh-in exactly as it sees an
athlete-stated one. The shared prompt rule states that the athlete's own value
wins when the two conflict.

## Sync algorithm

1. Sync activities and their analyses first. A failed activity sync stops the
   run; daily health is never fetched without fresh activities.
2. Compute the 42-day window ending today.
3. Walk dates from today backwards. Refresh today and yesterday even when a
   watermark exists; for older dates skip those already marked in
   `garmin_daily_sync`.
4. For each date, call `/daily`, store every value, then write the day's
   watermark. On `429`, stop immediately and keep the watermarks written so
   far. On any other per-day failure, log it, leave that date unmarked, and
   stop the pass so the next visit retries it.
5. Daily health is supplementary: a rate limit or outage is logged and never
   fails the activity feed.

## Acceptance criteria

1. `/daily` returns the normalized metrics above for a stubbed Garmin day,
   omitting values that were not recorded.
2. A `429` from any underlying call is surfaced as `429`; a non-rate-limit
   failure omits only that source's metrics.
3. The API fetches today, refreshes today and yesterday on a later run, skips
   already-watermarked older dates, and stops at the 42-day floor or a `429`.
4. Values are upserted into `athlete_daily_metrics` and watermarks into
   `garmin_daily_sync`.
5. A curated summary appears in the plan, reply, period-review and activity
   analysis prompts, filtered through the relevant date.
6. Unit tests cover daily normalization, date planning, `429` handling, storage
   calls and prompt formatting. Quality gates pass.

## Risks / open questions

- Each day costs up to four Garmin requests, so the first 42-day backfill can
  hit the same rate limit as the activity sync. The per-day watermark makes the
  backfill resumable rather than restarting.
- Garmin's response shapes vary by device and firmware. Every field is read
  defensively and validated before it is stored; an unknown shape stores
  nothing rather than a wrong number.
- Sleep and readiness for "today" may be incomplete early in the day. Today and
  yesterday are refreshed on every pass. A sleep window Garmin has not confirmed
  yet, or one whose total is still zero, is not stored, so the last completed
  night stays in the series.
- Body Battery high and low are running values for the current day, not final
  daily summaries. The coach prompt and the Fitness page therefore use the last
  completed day's values until the current day is over; the stored current-day
  values become visible the next day.
- The app has no existing health-metrics UI. This spec deliberately stops at
  storage and prompt context.
