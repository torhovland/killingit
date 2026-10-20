import { z } from "zod";

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
});

export type ActivitySummary = z.infer<typeof activitySummarySchema>;
