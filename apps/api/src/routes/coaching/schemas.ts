import { planDateSchema, reviewKindSchema } from "@killingit/shared";
import { z } from "zod";

/**
 * The activity a comment, acknowledgement or deletion addresses. A Garmin id
 * and a manual entry's id are both text, so the path value stays a bounded
 * non-empty string rather than a number.
 */
export const activityIdParamSchema = z.object({
  activityId: z.string().min(1).max(100),
});

/** The completed week or block a review route addresses. */
export const reviewParamSchema = z.object({
  kind: reviewKindSchema,
  startDate: planDateSchema,
});
