# Garmin activity laps

## Goal

Give the coach the athlete's recorded lap/interval structure — per-lap duration,
distance, average and maximum power, average and maximum heart rate, average
speed/pace, cadence and elevation — so it can judge whether an interval or
tempo session was actually executed as prescribed, and show that structure on
the activity card.

Today the sync keeps only the activity summary and a downsampled timeseries.
Interval structure is therefore invisible to the coach unless it reverse
engineers it from raw samples, and Garmin's own lap averages are never used.

## Scope

- Fetch Garmin's activity splits (laps) in the sidecar and normalize them into
  a bounded `laps` array on the shared activity summary.
- Feed lap averages to every prompt that answers the athlete about a recorded
  workout: activity analysis and the plan/reply context.
- Show a collapsible per-lap table on the Activity card, next to the recorded
  samples table.
- No database migration: activities are stored as JSON, so the new optional
  field flows through the existing feed.

Out of scope: Garmin's aggregate `fastestSplit_1000`/`fastestSplit_1609`
summary fields (tracked separately in `garmin-activity-metrics.md`), and
per-sample lap assignment.

## Data model

`packages/shared/src/activity.ts` gains:

```ts
export const activityLapSchema = z.object({
  index: z.number().int().nonnegative(),
  type: z.string().trim().min(1).optional(), // ACTIVE / REST / interval / …
  startTime: z.string().datetime().optional(),
  distance: z.number().nonnegative().optional(), // metres
  movingTime: z.number().nonnegative().optional(), // seconds
  elapsedTime: z.number().nonnegative().optional(), // seconds
  averageHeartRate: z.number().nonnegative().optional(),
  maxHeartRate: z.number().nonnegative().optional(),
  averagePower: z.number().nonnegative().optional(),
  maxPower: z.number().nonnegative().optional(),
  averageSpeed: z.number().nonnegative().optional(), // m/s
  averageCadence: z.number().nonnegative().optional(),
  totalElevationGain: z.number().optional(), // metres
});
```

`activitySummarySchema` gains `laps: z.array(activityLapSchema).optional()`.
Absent means "no laps recorded", which is different from an empty list. A single
lap only restates the whole activity, so it carries no interval structure: the
sidecar normalizes it away and consumers ignore a one-element list.

## Sidecar mapping

`Garmin.get_activity_splits(activity_id)` returns `{ "lapDTOs": [...] }`.
`_to_laps` maps each lap defensively, because field names vary by device and
sport:

| Normalized           | Garmin keys, first present wins                         |
| -------------------- | ------------------------------------------------------- |
| `index`              | `lapIndex`, `lap`; falls back to 1-based position       |
| `type`               | `intensityType`, `lapType`                              |
| `startTime`          | `startTimeGMT`, `startTimeLocal`                        |
| `distance`           | `distance`                                              |
| `movingTime`         | `movingDuration`                                        |
| `elapsedTime`        | `duration`                                              |
| `averageHeartRate`   | `averageHR`, `avgHR`                                    |
| `maxHeartRate`       | `maxHR`                                                 |
| `averagePower`       | `averagePower`, `avgPower`                              |
| `maxPower`           | `maxPower`                                              |
| `averageSpeed`       | `averageSpeed`, `averageMovingSpeed`, `avgSpeed`        |
| `averageCadence`     | `averageBikeCadence`, `averageRunCadence`, `avgCadence` |
| `totalElevationGain` | `elevationGain`                                         |

A lap with none of these values beyond its index is dropped, and the list is
only attached when at least two laps remain: a single lap is the whole activity
restated, not interval structure. The list is capped at `MAX_LAPS = 100` to
bound the stored feed and the prompt. A failed splits fetch leaves the activity
without laps (the same fail-open path as the timeseries), while a rate limit is
re-raised.

## Prompt rendering

`formatLaps` in `apps/api/src/llm/activityContext.ts` renders one line per lap:

```
Recorded laps:
- 1 (warmup): 10:00, 3.05 km, avg 180 W, 135 bpm
- 2: 4:00, 1.20 km, avg 350 W, max 420 W, 4:00/km, 168 bpm
```

Only recorded values are listed; speed is rendered as pace for pace sports, and
cadence uses the sport's unit. At most 40 laps are shown, with a count line when
more were recorded. A single lap is ignored everywhere, so a session without
real lap structure reads exactly like an activity with no laps. The block is
part of `formatActivitySummary`, so the activity analysis receives it, and
`formatActivity` adds a compact one-line lap summary to the plan and reply
context.

## Acceptance criteria

1. A real-shaped `lapDTOs` payload maps to normalized laps, including aliases,
   missing channels being omitted, and the 100-lap cap. A single-lap result is
   treated as no laps.
2. A failed splits request yields `laps` absent and does not fail the sync; a
   rate limit is surfaced as 429.
3. The activity analysis prompt contains the lap table; the plan context
   contains a compact lap line.
4. The Activity card shows a collapsible lap table when laps exist, and nothing
   when they do not.
5. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test` and the
   sidecar's pytest suite pass.
