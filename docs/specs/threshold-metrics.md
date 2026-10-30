# Threshold metrics per sport

## Goal

An athlete's threshold is a property of a sport, not only of cycling. The app
must capture and use any threshold measure the athlete states — FTP, threshold
heart rate, functional threshold pace, critical power, critical swim speed,
running stress score, and similar — for the sport it belongs to.

## Scope

- Store threshold measurements per sport, measure, and day, with a display
  label, unit, and kind (power, heart rate, pace, speed, stress, other).
- Read thresholds from the athlete's profile answers, comments, notes, manual
  activities, review comments, and answered coach questions.
- Ask which sport a threshold belongs to when the athlete does not say, and do
  not store the value until the answer identifies the sport.
- Show every known measure wherever FTP was shown before.
- Chart one estimated-threshold line per measure on the Fitness page.
- Score an activity with the threshold for its sport. Fall back to the
  existing best-effort duration estimate when the sport has no usable
  threshold.

## Data model

`athlete_thresholds` replaces FTP rows in `athlete_metrics`:

| column          | meaning                                                                       |
| --------------- | ----------------------------------------------------------------------------- |
| `sport`         | Canonical sport key, e.g. `cycling`, `running`, `swimming`.                   |
| `measure`       | Stable lower-snake key, e.g. `ftp`, `threshold_heart_rate`, `threshold_pace`. |
| `label`         | Short athlete-facing name, e.g. `FTP`.                                        |
| `unit`          | Display unit: `W`, `bpm`, `s/km`, `km/h`, or `points`.                        |
| `kind`          | `power`, `heart_rate`, `pace`, `speed`, `stress`, or `other`.                 |
| `source`        | `user`, `garmin`, or `coach`.                                                 |
| `date`, `value` | One dated value.                                                              |

A unique key on `(user_id, sport, measure, date)` lets a sport hold several
measures on the same day, such as cycling FTP and cycling threshold heart rate.
The migration copies existing cycling FTP points into the new table.

The extractor returns dated statements with a `thresholds` array. A threshold
with a null sport is not stored; instead the coach asks which sport it is for.
Answered coach questions are included in later extraction input, so the value
is stored once the athlete answers.

## TSS

For an activity, the API derives its sport from the activity type and picks the
best available threshold for that sport and date:

1. `power` when normalized power is recorded;
2. `pace` or `speed` when distance and duration are recorded;
3. `heart_rate` when samples carry heart rate;
4. otherwise no measured score.

Pace/speed and heart-rate scores use the same scale as power TSS:
`hours × intensityFactor² × 100`, with the intensity factor being actual speed
over threshold speed or average heart rate over threshold heart rate. The
coach's TSS estimate and the duration fallback remain for activities that
cannot be measured.

## API and UI

- `GET /api/fitness` returns `thresholds: ThresholdHistorySeries[]`, one series
  per sport and measure.
- `GET /api/coaching/plan` returns the latest known threshold summaries.
- The Fitness page renames the chart to **Estimated threshold** and groups
  measures by unit so watts and beats per minute keep honest axes.
- Week, block, season, and day views show all known measures. The Day view
  still shows the absolute FTP used to build a downloadable bike workout.

## Acceptance criteria

- Two measures for one sport are stored and displayed independently.
- A threshold for running does not score a cycling activity.
- A threshold stated without a sport is not stored until the athlete answers
  the question.
- An activity with no threshold for its sport still receives a best-effort TSS.
- Existing cycling FTP points survive the migration.
