import { z } from "zod";
import { planDateSchema } from "./date.js";

/**
 * The daily health and recovery values the app stores from Garmin. Keys are
 * stable database identifiers; the catalog below owns the label and unit every
 * prompt and future UI uses.
 */
export const DAILY_HEALTH_METRIC_KEYS = [
  "resting_heart_rate",
  "sleep_duration",
  "sleep_score",
  "deep_sleep",
  "light_sleep",
  "rem_sleep",
  "awake_sleep",
  "hrv",
  "spo2",
  "respiration",
  "stress",
  "body_battery_high",
  "body_battery_low",
  "steps",
  "active_calories",
  "intensity_minutes",
  "training_readiness",
  "recovery_time",
  "vo2max",
  "vo2max_cycling",
] as const;

export type DailyHealthMetricKey = (typeof DAILY_HEALTH_METRIC_KEYS)[number];

export const dailyHealthMetricKeySchema = z.enum(DAILY_HEALTH_METRIC_KEYS);

/** Formats a stored minute count as hours and minutes. */
function formatMinutes(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) {
    return `${rest} min`;
  }
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export interface DailyHealthMetricDefinition {
  label: string;
  unit: string;
  /** Decimal places to show in a prompt or chart. */
  decimals: number;
  /** Minutes are shown as hours and minutes rather than a raw count. */
  duration?: boolean;
}

/** Display metadata for every stored daily health metric. */
export const DAILY_HEALTH_METRICS: Record<
  DailyHealthMetricKey,
  DailyHealthMetricDefinition
> = {
  resting_heart_rate: { label: "Resting heart rate", unit: "bpm", decimals: 0 },
  sleep_duration: {
    label: "Sleep duration",
    unit: "min",
    decimals: 0,
    duration: true,
  },
  sleep_score: { label: "Sleep score", unit: "", decimals: 0 },
  deep_sleep: { label: "Deep sleep", unit: "min", decimals: 0, duration: true },
  light_sleep: {
    label: "Light sleep",
    unit: "min",
    decimals: 0,
    duration: true,
  },
  rem_sleep: { label: "REM sleep", unit: "min", decimals: 0, duration: true },
  awake_sleep: {
    label: "Awake during sleep",
    unit: "min",
    decimals: 0,
    duration: true,
  },
  hrv: { label: "Overnight HRV", unit: "ms", decimals: 0 },
  spo2: { label: "SpO2", unit: "%", decimals: 0 },
  respiration: { label: "Respiration", unit: "breaths/min", decimals: 1 },
  stress: { label: "Stress", unit: "", decimals: 0 },
  body_battery_high: { label: "Body Battery high", unit: "", decimals: 0 },
  body_battery_low: { label: "Body Battery low", unit: "", decimals: 0 },
  steps: { label: "Steps", unit: "", decimals: 0 },
  active_calories: { label: "Active calories", unit: "kcal", decimals: 0 },
  intensity_minutes: { label: "Intensity minutes", unit: "min", decimals: 0 },
  training_readiness: { label: "Training readiness", unit: "", decimals: 0 },
  recovery_time: {
    label: "Recovery time",
    unit: "min",
    decimals: 0,
    duration: true,
  },
  vo2max: { label: "VO2max", unit: "ml/kg/min", decimals: 1 },
  vo2max_cycling: {
    label: "Cycling VO2max",
    unit: "ml/kg/min",
    decimals: 1,
  },
};

/**
 * Metrics that are running values for the current day rather than a completed
 * daily summary. A morning value is only the high or low so far, so the coach
 * and the Fitness page use the last completed day until this day is over.
 */
export const IN_PROGRESS_DAILY_HEALTH_METRICS: readonly DailyHealthMetricKey[] =
  ["body_battery_high", "body_battery_low"];

/** One stored daily health value. */
export const dailyHealthPointSchema = z.object({
  metric: dailyHealthMetricKeySchema,
  date: planDateSchema,
  value: z.number().finite(),
});

export type DailyHealthPoint = z.infer<typeof dailyHealthPointSchema>;

/**
 * The sidecar's normalized response for one day. Only values Garmin actually
 * recorded are present; an empty object is a valid day with no device data.
 */
export const garminDailyResponseSchema = z.object({
  date: planDateSchema,
  metrics: z
    .partialRecord(dailyHealthMetricKeySchema, z.number().finite())
    .default({}),
});

export type GarminDailyResponse = z.infer<typeof garminDailyResponseSchema>;

/** True when a metric is a running value for the current day. */
export function isInProgressDailyHealthMetric(
  metric: DailyHealthMetricKey,
): boolean {
  return IN_PROGRESS_DAILY_HEALTH_METRICS.includes(metric);
}

/**
 * Drops the current day's still-in-progress values from a daily health series,
 * so a reader shows the last completed day instead of a partial morning value.
 */
export function withoutInProgressDailyHealth(
  points: readonly DailyHealthPoint[],
  today: string,
): DailyHealthPoint[] {
  return points.filter(
    (point) =>
      point.date !== today || !isInProgressDailyHealthMetric(point.metric),
  );
}

/** Formats one stored daily health value with its display unit. */
export function formatDailyHealthValue(
  metric: DailyHealthMetricKey,
  value: number,
): string {
  const definition = DAILY_HEALTH_METRICS[metric];
  if (definition.duration === true) {
    return formatMinutes(value);
  }
  const rounded = value.toFixed(definition.decimals);
  return definition.unit === "" ? rounded : `${rounded} ${definition.unit}`;
}
