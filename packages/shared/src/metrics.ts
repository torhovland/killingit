import { z } from "zod";
import { planDateSchema } from "./plan.js";
import { addDays } from "./trainingLoad.js";

/** The athlete measurements the app stores as a daily time series. */
export const athleteMetricSchema = z.enum(["ftp", "weight", "body_fat"]);

export type AthleteMetric = z.infer<typeof athleteMetricSchema>;

/**
 * Who supplied a metric value. A `user` measurement is something the athlete
 * stated themselves, `garmin` comes from a synced scale or Garmin profile, and
 * `coach` is an estimate the LLM produced. Only coach estimates are replaced
 * when a newer estimate arrives.
 */
export const metricSourceSchema = z.enum(["user", "coach", "garmin"]);

export type MetricSource = z.infer<typeof metricSourceSchema>;

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
