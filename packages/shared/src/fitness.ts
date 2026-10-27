import { z } from "zod";
import { planDateSchema } from "./plan.js";
import { trainingLoadSchema } from "./trainingLoad.js";

/** One day of the fitness chart: the date plus its resolved training load. */
export const fitnessHistoryDaySchema = trainingLoadSchema.extend({
  date: planDateSchema,
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
 * stated an FTP.
 */
export const fitnessHistoryResponseSchema = z.object({
  days: z.array(fitnessHistoryDaySchema),
  ftp: z.array(ftpHistoryPointSchema),
});

export type FitnessHistoryResponse = z.infer<
  typeof fitnessHistoryResponseSchema
>;
