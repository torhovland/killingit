import { z } from "zod";
import { planDateSchema } from "./date.js";
import { coachResponseNotesSchema } from "./llm.js";
import { addDays } from "./trainingLoad.js";

/** The body measurements the app stores as a daily time series. */
export const athleteMetricSchema = z.enum(["weight", "body_fat"]);

export type AthleteMetric = z.infer<typeof athleteMetricSchema>;

/**
 * Who supplied a metric value. A `user` measurement is something the athlete
 * stated themselves, `garmin` comes from a synced scale or Garmin profile, and
 * `coach` is an estimate the LLM produced. Only coach estimates are replaced
 * when a newer estimate arrives.
 */
export const metricSourceSchema = z.enum(["user", "coach", "garmin"]);

export type MetricSource = z.infer<typeof metricSourceSchema>;

/**
 * How a threshold value is measured, which decides how an activity is scored
 * against it. `power` is in watts, `heart_rate` in beats per minute, `pace` in
 * seconds per kilometre, and `speed` in kilometres per hour. `stress` is a score
 * on the athlete's own stress scale. `stress` and `other` are displayed but not
 * used for a threshold-based TSS.
 */
export const thresholdKindSchema = z.enum([
  "power",
  "heart_rate",
  "pace",
  "speed",
  "stress",
  "other",
]);

export type ThresholdKind = z.infer<typeof thresholdKindSchema>;

/**
 * One threshold measurement the athlete stated: a value for a specific sport,
 * such as cycling FTP, running threshold heart rate, or threshold pace. The
 * sport and measure are free text so a new sport or metric does not need a
 * code change; `measure` is the stable key, while `label` is what the athlete
 * sees.
 */
export const athleteThresholdStatementSchema = z.object({
  date: planDateSchema,
  /** The sport the threshold belongs to, or null when the athlete did not say. */
  sport: z.string().trim().min(1).max(60).nullable().default(null),
  /** Stable lower-case key, e.g. `ftp`, `threshold_heart_rate`, `threshold_pace`. */
  measure: z.string().trim().min(1).max(80),
  /** Short display name, e.g. `FTP`, `Threshold heart rate`. */
  label: z.string().trim().min(1).max(80),
  /** Display unit, e.g. `W`, `bpm`, `s/km`, `km/h`, `points`. */
  unit: z.string().trim().min(1).max(20),
  kind: thresholdKindSchema,
  value: z.number().finite().positive().max(100_000),
});

export type AthleteThresholdStatement = z.infer<
  typeof athleteThresholdStatementSchema
>;

/** One stored threshold value for a sport, measure, and calendar day. */
export const athleteThresholdSchema = athleteThresholdStatementSchema
  .omit({ sport: true })
  .extend({
    sport: z.string().trim().min(1).max(60),
    source: metricSourceSchema,
  });

export type AthleteThreshold = z.infer<typeof athleteThresholdSchema>;

/** A threshold value plotted on the Fitness page. */
export const thresholdSeriesPointSchema = z.object({
  date: planDateSchema,
  value: z.number().finite(),
});

export type ThresholdSeriesPoint = z.infer<typeof thresholdSeriesPointSchema>;

/**
 * One threshold measure over time. A sport can have several series, for
 * example cycling FTP and cycling threshold heart rate.
 */
export const thresholdSeriesSchema = athleteThresholdStatementSchema
  .omit({ date: true, value: true })
  .extend({
    sport: z.string().trim().min(1).max(60),
    points: z.array(thresholdSeriesPointSchema).default([]),
  });

export type ThresholdSeries = z.infer<typeof thresholdSeriesSchema>;

/** The latest known value of one threshold measure. */
export const thresholdSummarySchema = athleteThresholdStatementSchema
  .omit({ sport: true })
  .extend({
    sport: z.string().trim().min(1).max(60),
    source: metricSourceSchema,
  });

export type ThresholdSummary = z.infer<typeof thresholdSummarySchema>;

/** One stored value for a metric on a calendar day. */
export const metricPointSchema = z.object({
  date: planDateSchema,
  value: z.number().finite(),
  source: metricSourceSchema,
});

export type MetricPoint = z.infer<typeof metricPointSchema>;

/** A daily value plotted on the Fitness page. */
export const fitnessMetricPointSchema = z.object({
  date: planDateSchema,
  value: z.number().finite(),
});

export type FitnessMetricPoint = z.infer<typeof fitnessMetricPointSchema>;

/** The body-composition series for the Fitness page. */
export const fitnessBodySchema = z.object({
  /** Body weight in kilograms. */
  weight: z.array(fitnessMetricPointSchema).default([]),
  /** Body fat as a percentage of body weight. */
  bodyFat: z.array(fitnessMetricPointSchema).default([]),
});

export type FitnessBody = z.infer<typeof fitnessBodySchema>;

/**
 * One body-composition sample normalized from Garmin. Either value may be
 * missing: not every scale records body fat, and a weigh-in may omit it.
 */
export const garminBodyMetricSampleSchema = z
  .object({
    date: planDateSchema,
    weightKg: z.number().positive().max(500).optional(),
    bodyFatPercent: z.number().positive().max(75).optional(),
  })
  .refine(
    (sample) =>
      sample.weightKg !== undefined || sample.bodyFatPercent !== undefined,
    { message: "A body metric sample needs a weight or a body-fat percentage" },
  );

export type GarminBodyMetricSample = z.infer<
  typeof garminBodyMetricSampleSchema
>;

/**
 * One dated measurement the athlete stated in their own words, as the coach
 * reads it: a stated FTP, body weight, or body-fat percentage. A statement
 * usually carries one value and leaves the others null.
 */
export const athleteMetricStatementSchema = z.object({
  date: planDateSchema,
  /** Body weight in kilograms. */
  weightKg: z.number().positive().max(500).nullable().default(null),
  /** Body fat as a percentage of body weight. */
  bodyFatPercent: z.number().positive().max(75).nullable().default(null),
  /** Threshold measurements stated for this date, one entry per sport/measure. */
  thresholds: z
    .array(athleteThresholdStatementSchema.omit({ date: true }))
    .default([]),
});

export type AthleteMetricStatement = z.infer<
  typeof athleteMetricStatementSchema
>;

/** The coach's reading of every measurement the athlete states. */
export const athleteMetricsResultSchema = z
  .object({
    statements: z.array(athleteMetricStatementSchema).default([]),
  })
  .extend(coachResponseNotesSchema.shape);

export type AthleteMetricsResult = z.infer<typeof athleteMetricsResultSchema>;

/** Response body of the Garmin sidecar's metric sync. */
export const garminFtpSampleSchema = z.object({
  date: planDateSchema,
  watts: z.number().int().min(50).max(2000),
});

export type GarminFtpSample = z.infer<typeof garminFtpSampleSchema>;

export const garminMetricsResponseSchema = z.object({
  metrics: z.array(garminBodyMetricSampleSchema).default([]),
  /** Garmin's historic cycling FTP, oldest first. */
  ftp: z.array(garminFtpSampleSchema).default([]),
});

export type GarminMetricsResponse = z.infer<typeof garminMetricsResponseSchema>;

/**
 * Turns an activity type into the sport a threshold is stored under. The
 * mapping keeps Garmin's many activity names on one stable key per sport.
 */
export function activitySport(type: string): string {
  const normalized = type.trim().toLowerCase();
  if (/cycl|bik|bicycle/.test(normalized)) {
    return "cycling";
  }
  if (/run|jog|trail/.test(normalized)) {
    return "running";
  }
  if (/swim/.test(normalized)) {
    return "swimming";
  }
  if (/row/.test(normalized)) {
    return "rowing";
  }
  if (/ski/.test(normalized)) {
    return "skiing";
  }
  if (/hik/.test(normalized)) {
    return "hiking";
  }
  if (/walk/.test(normalized)) {
    return "walking";
  }
  if (/strength|weight|gym/.test(normalized)) {
    return "strength";
  }
  const words = normalized.replace(/[_-]+/g, " ").split(/\s+/);
  return words[0] ?? "other";
}

/** A readable sport label for the athlete-facing UI. */
export function formatSport(sport: string): string {
  return activitySport(sport)
    .split(" ")
    .map((word, index) =>
      index === 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word,
    )
    .join(" ");
}

/**
 * Formats a threshold value with its unit. Pace values are seconds per
 * kilometre and read as `4:30 /km`; every other unit is shown plainly.
 */
export function formatThresholdValue(
  value: number,
  unit: string,
  kind: ThresholdKind,
): string {
  if (kind === "pace" || unit === "s/km") {
    const total = Math.round(value);
    const minutes = Math.floor(total / 60);
    const seconds = String(total % 60).padStart(2, "0");
    return `${minutes}:${seconds} /km`;
  }
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return `${rounded} ${unit}`;
}

/**
 * Interpolates a metric between known values and extrapolates after the last
 * one with the best-fit straight line through every known point. The extrapolated
 * line is anchored at the last measured value so a noisy fit does not make the
 * chart jump on the day after the measurement.
 *
 * Dates before the first known value are omitted: there is no evidence for a
 * value there. After the last known value the series continues to `endDate`,
 * which is the end of the planned window on the Fitness page.
 */
export function interpolateMetricSeries(
  points: readonly Pick<MetricPoint, "date" | "value">[],
  startDate: string,
  endDate: string,
): FitnessMetricPoint[] {
  const sorted = dedupeByDate(
    [...points]
      .filter((point) => Number.isFinite(point.value))
      .sort((a, b) => a.date.localeCompare(b.date)),
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) {
    return [];
  }

  const slope = bestFitSlope(sorted);
  const series: FitnessMetricPoint[] = [];
  for (
    let date = startDate < first.date ? first.date : startDate;
    date <= endDate;
    date = addDays(date, 1)
  ) {
    const value =
      date >= last.date
        ? last.value + slope * daysBetween(last.date, date)
        : interpolateAt(sorted, date);
    if (value !== null) {
      series.push({ date, value: roundMetric(value) });
    }
  }
  return series;
}

/** Linear interpolation between the two values surrounding `date`. */
function interpolateAt(
  sorted: readonly Pick<MetricPoint, "date" | "value">[],
  date: string,
): number | null {
  for (let index = 1; index < sorted.length; index += 1) {
    const right = sorted[index];
    const left = sorted[index - 1];
    if (right === undefined || left === undefined || date > right.date) {
      continue;
    }
    if (date === right.date) {
      return right.value;
    }
    const span = daysBetween(left.date, right.date);
    if (span <= 0) {
      return right.value;
    }
    const fraction = daysBetween(left.date, date) / span;
    return left.value + (right.value - left.value) * fraction;
  }
  return sorted[0]?.value ?? null;
}

/** The least-squares slope of value against day, in value units per day. */
export function bestFitSlope(
  points: readonly Pick<MetricPoint, "date" | "value">[],
): number {
  const sorted = dedupeByDate(
    [...points].sort((a, b) => a.date.localeCompare(b.date)),
  );
  const first = sorted[0];
  if (first === undefined || sorted.length < 2) {
    return 0;
  }
  const xs = sorted.map((point) => daysBetween(first.date, point.date));
  const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const meanY =
    sorted.reduce((sum, point) => sum + point.value, 0) / sorted.length;
  let covariance = 0;
  let variance = 0;
  for (const [index, point] of sorted.entries()) {
    const x = (xs[index] ?? 0) - meanX;
    covariance += x * (point.value - meanY);
    variance += x * x;
  }
  return variance === 0 ? 0 : covariance / variance;
}

/** Keeps the last value for a date when a caller supplies duplicates. */
function dedupeByDate<T extends Pick<MetricPoint, "date" | "value">>(
  sorted: T[],
): T[] {
  const result: T[] = [];
  for (const point of sorted) {
    const previous = result[result.length - 1];
    if (previous !== undefined && previous.date === point.date) {
      result[result.length - 1] = point;
    } else {
      result.push(point);
    }
  }
  return result;
}

/** Whole days from one `YYYY-MM-DD` date to another. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

/** Values are shown to one decimal on the chart, so round once here. */
function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}
