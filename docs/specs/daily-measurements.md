# Daily measurements

- **Status:** Accepted (implemented)
- **Date:** 2026-11-26
- **Related:** `docs/specs/body-metrics.md`, `docs/specs/diet-coaching.md`,
  `docs/specs/diet-log.md`, `docs/specs/diet-progress-targets.md`,
  `docs/specs/fitness-page.md`, ADR 0012, ADR 0021.

## Goal

An athlete who tracks body weight or body fat should not have to state a new
measurement in a comment or wait for a Garmin scale sync. A small reusable panel
lets them enter the measurements they track for a chosen day from the dashboard
and the Diet page, so the Body chart on the Fitness page stays current.

## Scope

### In scope

1. A shared list of the hand-entered body measures: weight in kilograms and body
   fat as a percentage.
2. `GET /api/measurements` reports the measures the athlete tracks. A measure is
   tracked once the athlete has at least one stored point for it, which is also
   what makes the Body chart draw its line.
3. `PUT /api/measurements` stores one day's entered values as `user` points,
   replacing a Garmin measurement or coach estimate for the same measure and day.
4. One reusable panel, "Daily measurements", with a date selector, one numeric
   field per tracked measure, and a "Log measurements" button.
5. The panel appears after "Log a meal" on the coaching dashboard and at the top
   of the Diet page.
6. A saved message confirms the entry. There is no coach comment and no LLM
   call for this write.

### Out of scope

- Choosing or configuring which measures to track. The stored body series is the
  source of truth, exactly as it is for the Body chart.
- Entering FTP or other thresholds. Those keep their own statements and plan
  estimates.
- Editing or deleting an existing measurement beyond replacing its value for the
  same measure and day.
- Reading the entered value back into the form. The panel saves the day the
  athlete selects; the Body chart shows the stored result.

## Data model

The existing `athlete_metrics` table and its `(user_id, metric, date)` unique
index are reused. No schema or migration changes are needed.

- Weight is stored as `metric = "weight"` in kilograms.
- Body fat is stored as `metric = "body_fat"` as a percentage.
- Hand-entered values use `source = "user"`, so they win over a Garmin value or
  coach estimate for the same measure and day. A measure the request omits keeps
  its stored value.

## API

### `GET /api/measurements`

Returns the measures the athlete tracks, in the panel's display order:

```json
{ "metrics": ["weight", "bodyFat"] }
```

`metrics` is empty when neither series has a point. The response shape is a
shared Zod schema, parsed by both the API and the web app.

### `PUT /api/measurements`

Body:

```json
{ "date": "2026-11-26", "weightKg": 81.4, "bodyFatPercent": 18.2 }
```

- `date` is required and uses the shared `YYYY-MM-DD` plan date schema.
- `weightKg` is positive and at most 500; `bodyFatPercent` is positive and at
  most 75.
- At least one value is required. Either value may be omitted; `null` is treated
  as omitted.
- The response is `{ "date": "2026-11-26", "saved": true }`.

A failed read or write returns the standard `503` unavailable error so the panel
can retry.

## UI

- `apps/web/src/measurements/DailyMeasurementsSection.tsx` owns the shared panel.
- The panel loads the tracked measures once. It renders nothing when the athlete
  tracks none, and it shows an error with a Retry action when the read fails.
- The date selector defaults to the athlete's local today and cannot be moved
  past it.
- Each tracked measure gets a numeric input with its unit in the label, such as
  "Weight (kg)" and "Body fat (%)".
- "Log measurements" is disabled while the request is in flight. A successful
  save shows "Measurements saved." through an accessible status message. A blank
  field is not sent, and at least one filled field is required before the request
  is made.
- The panel is placed after the food log on the coaching dashboard and above the
  diet goal on the Diet page. It is not gated by the diet-advice setting: the
  measurements feed the Body chart, which is independent of meal logging.

## Acceptance criteria

1. An athlete with a stored weight point and no body-fat point sees only the
   weight field; an athlete with both points sees both fields.
2. An athlete with no stored body point sees no panel.
3. Saving a weight and body-fat value for a day stores both as `user` points and
   replaces earlier Garmin or coach values for that measure and day.
4. Omitting one field keeps the stored value for that measure.
5. A blank form or an impossible value is rejected.
6. A successful save shows "Measurements saved." and makes no LLM call.
7. The same panel is rendered on the dashboard and the Diet page.
8. Typecheck, lint, format, unused-export check, and tests pass.

## Testing

- Shared schema tests: the tracked-measure response, one or both entered values,
  and rejection of an empty request and out-of-range values.
- API route tests: authentication, tracked detection from the stored series, a
  saved entry passed to the writer, validation failures, and the `503` paths.
- Database integration test: a hand-entered value replaces a Garmin value for the
  same measure and day while an omitted measure keeps its stored value.
- Web interaction tests: the panel hides without tracked measures, shows one
  field per tracked measure, saves the entered values with the selected date,
  confirms the save, and surfaces a failure.
