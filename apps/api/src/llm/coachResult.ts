import {
  coachResponseNotesSchema,
  planChangeScopeSchema,
  type PlanChangeScope,
} from "@killingit/shared";
import { z } from "zod";

/**
 * The schemas that parse the coach's structured answers to the activity-review
 * and reply prompts. Only the API parses these; the shared package keeps the
 * `coachAnalysisSchema` and `coachResponseNotesSchema` the wire carries. See
 * ADR 0055.
 */

/**
 * The fields that decide a plan refresh. `planChangeScope` is the contract the
 * coach answers; `planChangeNeeded` stays accepted so a stored or older answer
 * still parses. The API derives the boolean from the scope, and fails a missing
 * scope open to the widest change when the boolean asks for one.
 */
const planChangeFields = {
  // A malformed scope becomes the widest change without losing the rest of the
  // answer; a missing scope stays undefined so the boolean can decide.
  planChangeScope: planChangeScopeSchema.catch("season").optional(),
  planChangeNeeded: z.boolean().catch(true),
};

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
    ...planChangeFields,
  })
  .extend(coachResponseNotesSchema.shape);

type ParsedCoachAnalysisResult = z.infer<typeof coachAnalysisResultSchema>;

export type CoachAnalysisResult = Omit<
  ParsedCoachAnalysisResult,
  "planChangeScope"
> & {
  /** The highest level the analysis says the workout changes. */
  planChangeScope: PlanChangeScope;
};

/**
 * The structured reply to one athlete input. `reply` is shown to the athlete;
 * `planChangeScope` decides which plan levels are refreshed. A missing scope
 * fails open to the season when the boolean asks for a change.
 */
export const coachReplyResultSchema = z.object({
  reply: z.string().trim().min(1),
  ...planChangeFields,
});

type ParsedCoachReplyResult = z.infer<typeof coachReplyResultSchema>;

export type CoachReplyResult = Omit<
  ParsedCoachReplyResult,
  "planChangeScope"
> & {
  /** The highest level the reply says the input changes. */
  planChangeScope: PlanChangeScope;
};

/** The derived plan change decision, with the boolean in step with the scope. */
export interface PlanChangeDecision {
  planChangeNeeded: boolean;
  planChangeScope: PlanChangeScope;
}

/**
 * Derives the stored decision from a parsed answer. An explicit scope wins over
 * the boolean, including an inconsistent pair. Without a scope, a false flag is
 * `none` and anything else, including a missing flag, fails open to `season`.
 */
export function resolvePlanChange(input: {
  planChangeNeeded?: boolean | undefined;
  planChangeScope?: PlanChangeScope | undefined;
}): PlanChangeDecision {
  const scope =
    input.planChangeScope ??
    (input.planChangeNeeded === false ? "none" : "season");
  return { planChangeScope: scope, planChangeNeeded: scope !== "none" };
}
