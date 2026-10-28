import { z } from "zod";
import { fitnessBodySchema } from "./metrics.js";
import { planDateSchema } from "./plan.js";
import { trainingLoadSchema } from "./trainingLoad.js";

/**
 * One activity logged on a day of the fitness chart, shown when the athlete
 * points at that day. Imported activities carry a name and duration; manual
 * entries carry the athlete's own description.
 */
export const fitnessDayActivitySchema = z.object({
  /** Stable key, e.g. `activity-1234` or `manual-7`. */
  id: z.string().min(1),
  name: z.string().min(1),
  /** The raw activity type, formatted for display by the web app. */
  type: z.string().min(1),
  /** Time spent in minutes, when the source knows it. */
  durationMinutes: z.number().int().nonnegative().optional(),
});

export type FitnessDayActivity = z.infer<typeof fitnessDayActivitySchema>;

/** How far back the Fitness page looks. */
export const fitnessRangeSchema = z.enum([
  "week",
  "month",
  "quarter",
  "year",
  "all",
]);

export type FitnessRange = z.infer<typeof fitnessRangeSchema>;

/** The ranges in menu order. */
export const FITNESS_RANGES: readonly FitnessRange[] = [
  "week",
  "month",
  "quarter",
  "year",
  "all",
];

/** Menu labels for the range picker. */
export const FITNESS_RANGE_LABELS: Record<FitnessRange, string> = {
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
  all: "All time",
};

/** The range the Fitness page opens with. */
export const DEFAULT_FITNESS_RANGE: FitnessRange = "month";

/** The planned session for a day the stored plan covers. */
export const fitnessDayPlanSchema = z.object({
  title: z.string().min(1),
  type: z.enum(["workout", "rest"]),
  durationMinutes: z.number().int().nonnegative(),
});

export type FitnessDayPlan = z.infer<typeof fitnessDayPlanSchema>;

/** One day of the fitness chart: the date, its load, and what was done. */
export const fitnessHistoryDaySchema = trainingLoadSchema.extend({
  date: planDateSchema,
  activities: z.array(fitnessDayActivitySchema).default([]),
  /** The stored plan's session for the day, when the plan covers it. */
  planned: fitnessDayPlanSchema.nullable().default(null),
});

export type FitnessHistoryDay = z.infer<typeof fitnessHistoryDaySchema>;

/** The estimated FTP in effect on one day of the fitness chart. */
export const ftpHistoryPointSchema = z.object({
  date: planDateSchema,
  watts: z.number().int().nonnegative().max(2000),
});

export type FtpHistoryPoint = z.infer<typeof ftpHistoryPointSchema>;

/**
 * The fitness history for a window: one entry per calendar day, ascending, and
 * the estimated FTP for the same days. `ftp` is empty when the athlete has not
 * stated an FTP. `body` carries the interpolated body-weight and body-fat
 * series, empty when the athlete has no such data.
 */
export const fitnessHistoryResponseSchema = z.object({
  days: z.array(fitnessHistoryDaySchema),
  ftp: z.array(ftpHistoryPointSchema),
  body: fitnessBodySchema.default({ weight: [], bodyFat: [] }),
});

export type FitnessHistoryResponse = z.infer<
  typeof fitnessHistoryResponseSchema
>;
