# Spec: Garmin sport-specific activity metrics — findings and proposal

- **Status:** Proposed (findings only; no behaviour change yet)
- **Date:** 2026-11-03
- **Related:** `docs/specs/garmin-activity-integration.md`,
  `docs/specs/training-load.md`, `docs/specs/threshold-metrics.md`

## Goal

Record what Garmin exposes beyond the activity fields the app already stores,
decide which additional metrics are worth supporting, and propose a data model,
prompt shape and priority. This document does not change the sync or the UI; it
is the basis for a follow-up implementation.

## Method

The findings come from the operator's own last 42 days of Garmin activities,
read through the sidecar's existing `python-garminconnect` login:

- `get_activities_by_date()` for the activity summaries;
- `get_activity()` and `get_activity_details()` for one activity of each type
  where the list payload was missing a field;
- the shared normalized shape in `packages/shared/src/activity.ts` for what the
  app already keeps.

The sample contained 30 activities across eight normalized types: hiking,
indoor cardio, indoor cycling, indoor rowing, road biking, running, strength
training and virtual ride. There were no swim, dive or snow-sport activities in
the window, so the swim fields below come from Garmin's published activity
summary shape rather than from an observed activity.

No personal values are repeated here; the examples are units and ranges only.

## What the app stores today

Per activity: id, name, type, start time, distance, moving and elapsed time,
elevation gain, average and normalized power (from the recorded samples), and
the recorded strength sets. A separate proposed change adds average and maximum
speed and sport-aware pace rendering; this document assumes that change lands
first, because grade-adjusted pace builds on it. The feed keeps a bounded,
downsampled sample preview with timestamp, GPS position, heart rate, power,
temperature, speed, distance, elevation and cadence.

That covers the core endurance picture. The gaps are mostly recovery context,
sport-specific technique and intensity, and Garmin's own training-load figures.

## Findings by category

### All sports

These fields were present on most activities regardless of type.

| Garmin field                                                     | Unit              | What it adds                                                                                                                | Observed                  |
| ---------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `averageHR`, `maxHR`                                             | bpm               | Average and peak cardiovascular load. The app currently derives an average from samples only for TSS; it does not store it. | Yes                       |
| `aerobicTrainingEffect`, `anaerobicTrainingEffect`               | 0–5 score         | Garmin's estimate of the aerobic and anaerobic training stimulus. Useful for judging whether an easy day was actually easy. | Yes                       |
| `activityTrainingLoad`                                           | Garmin load units | Garmin's own load figure, useful as a cross-check against the app's TSS.                                                    | Yes                       |
| `avgRespirationRate`, `minRespirationRate`, `maxRespirationRate` | breaths/min       | Breathing response during the session.                                                                                      | Yes                       |
| `calories`                                                       | kcal              | Energy cost, useful context for long sessions and weight trends.                                                            | Yes                       |
| `minTemperature`, `maxTemperature`                               | °C                | Conditions actually encountered, not just the forecast.                                                                     | Yes on outdoor activities |
| `minElevation`, `maxElevation`                                   | m                 | Terrain range; complements total elevation gain.                                                                            | Yes on outdoor activities |
| `hrTimeInZone_1` … `hrTimeInZone_5`                              | seconds           | Time in each heart-rate zone. More actionable than an average alone.                                                        | Yes                       |
| `powerTimeInZone_1` … `powerTimeInZone_7`                        | seconds           | Time in each power zone for powered activities.                                                                             | Yes on powered activities |
| `differenceBodyBattery`                                          | points            | Garmin's recovery cost estimate.                                                                                            | Yes                       |
| `steps`                                                          | count             | Useful for runs, walks and hikes; not meaningful for rides.                                                                 | Yes                       |
| `waterEstimated`                                                 | ml                | Fluid-loss estimate; interesting but not coaching-critical.                                                                 | Yes                       |

**Recommendation: Tier 1.** Average/max heart rate, training effect, Garmin
training load, respiration, calories, temperature/elevation ranges and
HR/power zone times are cheap to read, apply across sports, and directly inform
the coach's recovery and intensity advice. They should be the next addition.
`differenceBodyBattery`, `steps` and `waterEstimated` were also observed but are
not in the proposed schema: they are cheap context, not coaching-critical, and
`steps` overlaps with the running cadence the app already records.

### Running

| Garmin field                                                                 | Unit      | What it adds                                                      | Observed |
| ---------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------- | -------- |
| `avgGradeAdjustedSpeed`                                                      | m/s       | Pace adjusted for gradient; makes hilly and flat runs comparable. | Yes      |
| `averageRunningCadenceInStepsPerMinute`, `maxRunningCadenceInStepsPerMinute` | steps/min | Cadence summary; the sample timeseries already carries cadence.   | Yes      |
| `avgStrideLength`                                                            | cm        | Stride length; pairs with cadence to show how speed was produced. | Yes      |
| `avgGroundContactTime`                                                       | ms        | Running economy / impact signal.                                  | Yes      |
| `avgGroundContactBalance`                                                    | % left    | Left/right balance.                                               | Yes      |
| `avgVerticalOscillation`                                                     | cm        | Vertical bounce.                                                  | Yes      |
| `avgVerticalRatio`                                                           | %         | Oscillation relative to stride length.                            | Yes      |
| `fastestSplit_1000`, `fastestSplit_1609`                                     | seconds   | Fastest 1 km and 1 mile splits.                                   | Yes      |
| `avgPower`, `maxPower`, `normPower`                                          | W         | Running power, where the device records it.                       | Yes      |

**Recommendation: Tier 2.** Grade-adjusted pace is the highest-value running
addition; it should be shown next to pace for runs. Stride length, ground
contact and vertical oscillation/ratio are useful for a running-focused athlete
but add prompt and UI noise for everyone else, so they should appear only when
recorded. Fastest splits are useful context for races and hard sessions.

### Cycling

| Garmin field                                                           | Unit          | What it adds                                                                                                                               | Observed |
| ---------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `avgPower`, `maxPower`, `normPower`                                    | W             | Garmin's power summary. The app already computes average and normalized power from samples; these are a fallback when samples are missing. | Yes      |
| `intensityFactor`                                                      | ratio         | Garmin's IF.                                                                                                                               | Yes      |
| `trainingStressScore`                                                  | Garmin TSS    | Garmin's own TSS, useful as a cross-check.                                                                                                 | Yes      |
| `max20MinPower`                                                        | W             | Best 20-minute effort.                                                                                                                     | Yes      |
| `maxAvgPower_1` … `maxAvgPower_18000`                                  | W             | Power-curve bests for 1 s through 5 h.                                                                                                     | Yes      |
| `averageBikingCadenceInRevPerMinute`, `maxBikingCadenceInRevPerMinute` | rpm           | Cadence summary; the sample timeseries already carries cadence.                                                                            | Yes      |
| `strokes`                                                              | pedal strokes | Total pedal revolutions; a Garmin-specific extra.                                                                                          | Yes      |

**Recommendation: Tier 2.** Store `maxPower`, `intensityFactor`, Garmin TSS,
`max20MinPower` and a compact power-curve record. Use Garmin's average and
normalized power only as a fallback; never mix them with the app's
sample-derived values in one number. Garmin TSS should be a comparison, not a
replacement for the app's threshold-scored TSS.

### Swimming

No swim activity was available in the sample. Garmin's activity summary shape
exposes the following fields; they should be verified against a real swim before
implementation.

| Garmin field                                                               | Unit             | What it adds                                                |
| -------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------- |
| `averageSwimCadenceInStrokesPerMinute`, `maxSwimCadenceInStrokesPerMinute` | strokes/min      | Stroke rate.                                                |
| `averageSwolf`                                                             | score            | Garmin's SWOLF efficiency score.                            |
| `avgStrokeDistance`                                                        | m (or pool unit) | Distance per stroke.                                        |
| `activeLengths`                                                            | count            | Number of active pool lengths.                              |
| `poolLength`, `unitOfPoolLength`                                           | m or yd          | Pool size, needed to interpret lengths and stroke distance. |
| `strokes`                                                                  | count            | Total strokes.                                              |

**Recommendation: Tier 3.** Add these only if swimming is a supported coaching
sport. Normalize `poolLength` and `avgStrokeDistance` to metres using
`unitOfPoolLength`; otherwise the numbers silently mix yards and metres.

### Rowing

| Garmin field           | Unit        | What it adds                                                                         | Observed                                                                                |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `maxStrokeCadence`     | strokes/min | Peak stroke rate.                                                                    | Yes                                                                                     |
| `averageStrokeCadence` | strokes/min | Average stroke rate.                                                                 | Only on `get_activity()` in the sampled indoor rowing activity, not on the list payload |
| `strokes`              | count       | Total strokes.                                                                       | Yes                                                                                     |
| `distance`             | m           | Often zero on the list payload for indoor rowing; without it no pace can be derived. | Yes (zero)                                                                              |

**Recommendation: Tier 3.** Stroke cadence and stroke count are useful for
rowing, but the app needs a reliable distance or split first. Do not invent a
pace when Garmin reports no distance.

### Strength

| Garmin field              | Unit   | What it adds                                                                                    | Observed |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------- | -------- |
| `totalSets`, `activeSets` | count  | Session volume summary.                                                                         | Yes      |
| `totalReps`               | count  | Total repetitions.                                                                              | Yes      |
| `summarizedExerciseSets`  | nested | Already read through `get_activity_exercise_sets()`; the summary totals are a compact fallback. | Yes      |

**Recommendation: Tier 3.** The detailed exercise sets are already more useful
than the totals. Add the totals only as a cheap summary for prompts that do not
need every set.

## Proposed data model

Add one optional nested object to `ActivitySummary` rather than a dozen more
top-level fields:

```ts
export const activityMetricsSchema = z.object({
  // All sports
  averageHeartRate: z.number().nonnegative().optional(),
  maxHeartRate: z.number().nonnegative().optional(),
  aerobicTrainingEffect: z.number().nonnegative().optional(),
  anaerobicTrainingEffect: z.number().nonnegative().optional(),
  activityTrainingLoad: z.number().nonnegative().optional(),
  averageRespirationRate: z.number().nonnegative().optional(),
  minRespirationRate: z.number().nonnegative().optional(),
  maxRespirationRate: z.number().nonnegative().optional(),
  calories: z.number().nonnegative().optional(),
  minTemperature: z.number().optional(),
  maxTemperature: z.number().optional(),
  minElevation: z.number().optional(),
  maxElevation: z.number().optional(),
  heartRateZoneSeconds: z.array(z.number().nonnegative()).optional(),
  powerZoneSeconds: z.array(z.number().nonnegative()).optional(),

  // Running
  averageGradeAdjustedSpeed: z.number().nonnegative().optional(),
  averageStrideLengthCm: z.number().nonnegative().optional(),
  averageGroundContactTimeMs: z.number().nonnegative().optional(),
  averageGroundContactBalancePercent: z.number().min(0).max(100).optional(),
  averageVerticalOscillationCm: z.number().nonnegative().optional(),
  averageVerticalRatioPercent: z.number().nonnegative().optional(),
  fastestSplit1kmSeconds: z.number().nonnegative().optional(),
  fastestSplit1mileSeconds: z.number().nonnegative().optional(),

  // Cycling
  intensityFactor: z.number().nonnegative().optional(),
  trainingStressScore: z.number().nonnegative().optional(),
  max20MinPowerWatts: z.number().nonnegative().optional(),
  powerCurveBests: z
    .array(
      z.object({
        seconds: z.number().int().positive(),
        watts: z.number().nonnegative(),
      }),
    )
    .optional(),

  // Swimming and rowing
  averageStrokeCadence: z.number().nonnegative().optional(),
  maxStrokeCadence: z.number().nonnegative().optional(),
  strokeCount: z.number().int().nonnegative().optional(),
  averageSwolf: z.number().nonnegative().optional(),
  averageStrokeDistanceM: z.number().nonnegative().optional(),
  activeLengths: z.number().int().nonnegative().optional(),
  poolLengthM: z.number().nonnegative().optional(),

  // Strength
  totalSets: z.number().int().nonnegative().optional(),
  activeSets: z.number().int().nonnegative().optional(),
  totalReps: z.number().int().nonnegative().optional(),
});
```

`metrics` stays optional so older cached feeds and non-Garmin sources still
parse. Units live in the field names where they are not obvious. `strokes` is
sport-specific (pedal strokes, rowing strokes or swim strokes), so the shared
field is `strokeCount` and the prompt/UI label is chosen from the activity type.

The sidecar should omit a metric when Garmin does not report it. It should not
zero-fill, because zero is a meaningful value for some metrics (for example
`anaerobicTrainingEffect` and time in a zone).

### Power fields

Keep the existing top-level `averagePower` and `normalizedPower`. Add
`maxPower` next to them. In the sidecar, use Garmin's `avgPower` and `normPower`
as fallbacks when the detail samples are missing; the API's existing
`recordedPowerSummary()` continues to override them when samples are present.
Garmin's `intensityFactor`, `trainingStressScore`, `max20MinPower` and
power-curve bests live in `metrics`.

## Prompt impact

- `formatActivitySummary()` (activity analysis and program review) gains a
  compact "Recorded metrics" block. It should print only fields that exist, one
  line per group, for example:
  - `Heart rate: average 143 bpm, maximum 174 bpm`
  - `Training effect: aerobic 3.2, anaerobic 0.4; Garmin load 135`
  - `Heart-rate zones: Z1 59:00, Z2 58:44, Z3 19:49, Z4 10:08, Z5 0:17`
  - `Running: grade-adjusted pace 5:12 /km, cadence 131 spm, stride 88 cm, ground contact 415 ms (49% left), vertical oscillation 8.4 cm (9.4%)`
  - `Cycling: maximum power 574 W, IF 0.70, Garmin TSS 120, best 20 min 178 W`
  - `Swimming: SWOLF 42, stroke rate 28/min, 1.8 m per stroke, 40 lengths in a 25 m pool`
  - `Rowing: stroke rate 19/min (max 23), 300 strokes`
  - `Strength: 15 sets, 124 reps`
- `formatActivity()` (the recent-workout lines in planning, reply and review
  prompts) gains a short metrics line, not the full block: average/max heart
  rate, training effect, Garmin load, and the sport's headline metric. This
  keeps the planning prompt readable while still giving the coach the new
  signal.
- The activity-analysis prompt version is bumped when these fields are added so
  new analyses record the new prompt. Existing cached analyses are reused, and
  only a newer athlete comment regenerates one.

## UI impact

Add a collapsible "Recorded metrics" section below the sample table on the
activity card (the dashboard and Activities page share that component). Render
only present fields, grouped as in the prompt, with sport-aware labels and
units. Do not put twenty metrics in the header line; the existing distance,
pace/speed, duration and climb line should stay short.

## Risks and caveats

- **Units vary by device.** `avgStrideLength` is centimetres,
  `avgGroundContactTime` is milliseconds, `avgVerticalOscillation` is
  centimetres, and `poolLength` depends on `unitOfPoolLength`. Normalize at the
  sidecar boundary and keep units in the field names.
- **Some fields are only on the detail endpoint.** The sampled indoor rowing
  activity had `maxStrokeCadence` and `strokes` on the list payload but
  `averageStrokeCadence` only on `get_activity()`. Fetching one detail request
  per activity is an extra Garmin request; it should be optional and fail open.
- **Garmin's load is not the app's TSS.** Garmin's `trainingStressScore`,
  `intensityFactor` and `activityTrainingLoad` use Garmin's own thresholds and
  algorithms. Store and display them as Garmin values, and keep the app's
  threshold-scored TSS as the number that drives ATL/CTL/TSB.
- **Zero is not missing.** A zero anaerobic training effect or zero time in a
  zone is real data. Omit absent fields; keep recorded zeros.
- **Prompt size.** The full metric block is acceptable for one activity review,
  but not for every recent activity in a planning prompt. Use the compact
  planning line there.
- **Sport coverage.** The swim fields are unverified against a real swim. The
  diving and snow-sport fields (depth, N2, air pressure, vertical speed, etc.)
  are out of scope for an endurance coaching app.

## Recommendation

Implement in three steps:

1. **Tier 1 — recovery and intensity context (next).** Average/max HR, training
   effect, Garmin load, respiration, calories, temperature/elevation ranges and
   HR/power zone times. This is the best value for the least sport-specific
   complexity.
2. **Tier 2 — running and cycling detail.** Grade-adjusted pace and running
   dynamics for runs; maximum power, IF, Garmin TSS, 20-minute power and
   power-curve bests for rides.
3. **Tier 3 — swim, row and strength summaries.** Only when those sports are
   actively coached; verify the swim field names and units against a real swim
   first.

The pace/speed work already proposed separately (storing `averageSpeed` and
`maxSpeed` and showing pace for pace-based sports) is the prerequisite for the
grade-adjusted pace addition and should land first.

## Acceptance criteria for a follow-up implementation

1. The sidecar reads the Tier 1 fields from the activity summary and omits
   absent values without zero-filling.
2. `ActivitySummary` carries the optional `metrics` object and the shared
   schemas still parse older cached feeds.
3. Activity-analysis prompts include a compact recorded-metrics block; planning
   prompts include only the short headline line.
4. The activity card shows a collapsible recorded-metrics section, with
   sport-aware labels and units.
5. Garmin's TSS/IF/load are never used to replace the app's threshold-scored
   TSS in the training-load series.
6. Unit tests cover metric extraction, omission of absent values, unit
   normalization and prompt rendering; the existing quality gates pass.
