import { z } from "zod";

/** One exercise recorded inside a Garmin strength set. */
export const strengthExerciseSchema = z.object({
  /** Garmin FIT category, for example `SQUAT` or `BENCH_PRESS`. */
  category: z.string().trim().min(1),
  /** Garmin FIT sub-category, when the device recorded one. */
  name: z.string().trim().min(1).nullable().optional(),
});

export type StrengthExercise = z.infer<typeof strengthExerciseSchema>;

/**
 * One set performed in a strength-training activity. Garmin records active and
 * rest sets separately; absent channels are omitted rather than zeroed, because
 * a bodyweight set legitimately has no weight.
 */
export const strengthSetSchema = z.object({
  /** `active` or `rest` as reported by Garmin. */
  setType: z.string().trim().min(1).optional(),
  /** ISO-8601 UTC start of the set. */
  startTime: z.string().datetime().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  repetitions: z.number().int().nonnegative().optional(),
  /** The recorded load in kilograms. */
  weightKg: z.number().nonnegative().optional(),
  exercises: z.array(strengthExerciseSchema).default([]),
});

export type StrengthSet = z.infer<typeof strengthSetSchema>;

/**
 * One recorded lap (or auto-lap/interval split) of an activity. Garmin records
 * active and rest laps separately; absent channels are omitted rather than
 * zeroed, so a lap without power does not claim `0 W`. Times are seconds,
 * distance and elevation are metres, and speed is metres per second.
 */
export const activityLapSchema = z.object({
  /** 1-based lap number as the device recorded it. */
  index: z.number().int().nonnegative(),
  /** `active`, `rest` or an interval label, as the source reports it. */
  type: z.string().trim().min(1).optional(),
  /** ISO-8601 UTC start of the lap. */
  startTime: z.string().datetime().optional(),
  distance: z.number().nonnegative().optional(),
  /** Moving time when the source reports it, otherwise omitted. */
  movingTime: z.number().nonnegative().optional(),
  /** Elapsed time of the lap. */
  elapsedTime: z.number().nonnegative().optional(),
  averageHeartRate: z.number().nonnegative().optional(),
  maxHeartRate: z.number().nonnegative().optional(),
  averagePower: z.number().nonnegative().optional(),
  maxPower: z.number().nonnegative().optional(),
  /** Mean speed in metres per second; render as pace for pace-based sports. */
  averageSpeed: z.number().nonnegative().optional(),
  /** Mean cadence in the sport's unit (rpm for cycling, steps/min for runs). */
  averageCadence: z.number().nonnegative().optional(),
  totalElevationGain: z.number().optional(),
});

export type ActivityLap = z.infer<typeof activityLapSchema>;

/**
 * A normalized, minimal summary of an activity from any data source (currently
 * Garmin; a future source maps into the same shape). Only the fields the
 * coaching features will need — kept intentionally small (ADR 0003
 * single-operator phase).
 */
export const activitySummarySchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string(),
  startDate: z.string().datetime(),
  distance: z.number(),
  movingTime: z.number(),
  elapsedTime: z.number(),
  totalElevationGain: z.number(),
  /**
   * Time-weighted mean power of the recorded samples, in watts. Present only
   * when the activity has power data, so consumers can distinguish measured
   * power from an estimate.
   */
  averagePower: z.number().nonnegative().nullable().optional(),
  /** Normalized power from the recorded samples, in watts. */
  normalizedPower: z.number().nonnegative().nullable().optional(),
  /**
   * Mean speed in metres per second, as recorded by the source or derived from
   * distance and moving time. Sports whose source records pace rather than
   * speed are normalized into this field, so speed and pace never disagree.
   */
  averageSpeed: z.number().nonnegative().nullable().optional(),
  /** Maximum recorded speed in metres per second. */
  maxSpeed: z.number().nonnegative().nullable().optional(),
  /**
   * Recorded strength-training sets. Only strength activities that carry
   * exercise data have this field; absent means none were recorded.
   */
  strengthSets: z.array(strengthSetSchema).optional(),
  /**
   * Recorded laps (auto-laps or interval splits) with their averages. Absent
   * when the source recorded none, which is different from an empty list.
   */
  laps: z.array(activityLapSchema).optional(),
});

export type ActivitySummary = z.infer<typeof activitySummarySchema>;

/** One GPS point retained for the activity route preview. */
export const routePointSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export type RoutePoint = z.infer<typeof routePointSchema>;

/**
 * One recorded point in an activity's timeseries. Channels are optional: a
 * sample only carries the values the device recorded at that moment.
 *
 * Units: latitude/longitude degrees, heartRate bpm, power W, temperature °C,
 * speed m/s, distance m (cumulative), elevation m, cadence rpm (bike) or
 * steps/min (run) as reported by the source.
 */
export const activitySampleSchema = z.object({
  timestamp: z.string().datetime(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  heartRate: z.number().optional(),
  power: z.number().optional(),
  temperature: z.number().optional(),
  speed: z.number().optional(),
  distance: z.number().optional(),
  elevation: z.number().optional(),
  cadence: z.number().optional(),
});

export type ActivitySample = z.infer<typeof activitySampleSchema>;

/**
 * A synced activity: the summary plus its normalized workout timeseries.
 *
 * `samples` defaults to an empty list so payloads from a sidecar older than the
 * timeseries change still parse instead of crashing the UI.
 */
export const activitySchema = activitySummarySchema.extend({
  samples: z.array(activitySampleSchema).default([]),
});

export type Activity = z.infer<typeof activitySchema>;

/** Response body of the Garmin sync endpoint (`GET /api/garmin/activities`). */
export const activitiesResponseSchema = z.object({
  activities: z.array(activitySchema),
});

export type ActivitiesResponse = z.infer<typeof activitiesResponseSchema>;

/**
 * Sports whose progress is normally read as pace rather than speed. Garmin
 * records speed for these too, but displays pace in Connect, so the app follows
 * the athlete's unit.
 */
const PACE_ACTIVITY_PATTERN = /run|jog|walk|hik|swim|row|ski/;

/**
 * Sports whose cadence is counted in steps or strokes per minute rather than
 * pedal revolutions. Garmin's running and hiking channels are already totals,
 * and rowing and swimming report strokes per minute.
 */
const STEP_CADENCE_PATTERN = /run|jog|walk|hik|row|swim/;

/**
 * Whether an activity's recorded laps carry interval structure. A single lap
 * only restates the whole activity, so it is treated as no laps at all.
 */
export function hasLapStructure(
  laps: readonly ActivityLap[] | undefined,
): laps is readonly ActivityLap[] {
  return laps !== undefined && laps.length > 1;
}

/**
 * Whether a normalized activity type is a run. Running cadence is measured in
 * total steps per minute, while cycling cadence is the pedalling rate in rpm.
 */
export function isRunningActivity(type: string): boolean {
  return type.toLowerCase().includes("run");
}

/** The unit an activity's recorded cadence is expressed in. */
export function cadenceUnit(type: string): "spm" | "rpm" {
  return STEP_CADENCE_PATTERN.test(type.trim().toLowerCase()) ? "spm" : "rpm";
}

/** Whether an activity's speed should be shown and described as pace. */
export function activityUsesPace(type: string): boolean {
  return PACE_ACTIVITY_PATTERN.test(type.trim().toLowerCase());
}

/**
 * The distance one pace interval covers for an activity, in metres. Running and
 * most other pace sports use a kilometre, swimming uses 100 m, and rowing uses
 * the 500 m split Garmin Connect shows.
 */
export function paceUnitMetres(type: string): number {
  const normalized = type.trim().toLowerCase();
  if (/swim/.test(normalized)) {
    return 100;
  }
  if (/row/.test(normalized)) {
    return 500;
  }
  return 1000;
}

/** The unit suffix for an activity's pace, such as `/km` or `/500m`. */
export function paceUnitLabel(type: string): string {
  const metres = paceUnitMetres(type);
  return metres === 1000 ? "/km" : `/${metres}m`;
}

/** Formats a duration in seconds as `m:ss`, the usual pace notation. */
export function formatPace(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "–";
  }
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

/** Formats a speed in metres per second as kilometres per hour. */
export function formatSpeed(speedMps: number): string {
  return `${(speedMps * 3.6).toFixed(1)} km/h`;
}

/**
 * Formats a speed the way the activity's sport is normally read: pace for runs,
 * walks, hikes, swims, rows and skis, and speed for rides and other sports.
 */
export function formatActivityPaceOrSpeed(
  type: string,
  speedMps: number,
): string | null {
  if (!Number.isFinite(speedMps) || speedMps <= 0) {
    return null;
  }
  if (!activityUsesPace(type)) {
    return formatSpeed(speedMps);
  }
  return `${formatPace(paceUnitMetres(type) / speedMps)} ${paceUnitLabel(type)}`;
}

/**
 * The activity's mean speed in metres per second. Uses the source's recorded
 * average when it has one, otherwise derives it from distance and moving time
 * (falling back to elapsed time), so older stored activities and sources that
 * record only distance still show a pace.
 */
export function activityAverageSpeed(
  activity: Pick<
    ActivitySummary,
    "distance" | "movingTime" | "elapsedTime" | "averageSpeed"
  >,
): number | null {
  const recorded = activity.averageSpeed;
  if (recorded !== null && recorded !== undefined && recorded > 0) {
    return recorded;
  }
  const duration =
    activity.movingTime > 0 ? activity.movingTime : activity.elapsedTime;
  if (activity.distance > 0 && duration > 0) {
    return activity.distance / duration;
  }
  return null;
}

/**
 * Turns a source activity key such as `indoor_cycling` into readable text
 * (`Indoor cycling`) for display. Unknown keys are still shown rather than
 * hidden, because the device's classification is the best information we have.
 */
export function formatActivityType(type: string): string {
  const words = type
    .trim()
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter((word) => word !== "");

  if (words.length === 0) {
    return "Unknown activity";
  }

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (lower === "gps") {
        return "GPS";
      }
      return index === 0
        ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`
        : lower;
    })
    .join(" ");
}
