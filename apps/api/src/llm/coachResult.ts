import { z } from "zod";
import { coachResponseNotesSchema } from "@killingit/shared";

/**
 * The schemas that parse the coach's structured answers to the activity-review
 * and reply prompts. Only the API parses these; the shared package keeps the
 * `coachAnalysisSchema` and `coachResponseNotesSchema` the wire carries. See
 * ADR 0055.
 */

/**
 * The structured response the coach returns for an activity analysis. The
 * visible analysis stays plain text, while the FTP estimate is persisted as a
 * coach-sourced point in the athlete's FTP time series. Body weight and body-fat
 * values the athlete stated for the activity are stored the same way.
 */
export const coachAnalysisResultSchema = z
  .object({
    analysis: z.string().trim().min(1),
    estimatedFtpWatts: z
      .number()
      .int()
      .min(50)
      .max(2000)
      .nullable()
      .default(null),
    /** Body weight in kilograms when the activity's input states it. */
    weightKg: z.number().positive().max(500).nullable().default(null),
    /** Body fat as a percentage of body weight when the input states it. */
    bodyFatPercent: z.number().positive().max(75).nullable().default(null),
    /**
     * Whether this workout changes what the coach would prescribe. Fails open:
     * a missing or malformed flag is treated as a request to refresh, so an
     * unparsed answer cannot silently drop a needed revision.
     */
    planChangeNeeded: z.boolean().catch(true),
  })
  .extend(coachResponseNotesSchema.shape);

export type CoachAnalysisResult = z.infer<typeof coachAnalysisResultSchema>;

/**
 * The structured reply to one athlete input. `reply` is shown to the athlete;
 * `planChangeNeeded` decides whether the plan is refreshed. It fails open: a
 * missing or malformed flag is treated as true, so a model that ignores the
 * contract still refreshes the plan.
 */
export const coachReplyResultSchema = z.object({
  reply: z.string().trim().min(1),
  planChangeNeeded: z.boolean().catch(true),
});

export type CoachReplyResult = z.infer<typeof coachReplyResultSchema>;
