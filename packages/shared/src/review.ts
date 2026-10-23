import { z } from "zod";
import { coachAnalysisSchema } from "./llm.js";
import { planDateSchema } from "./plan.js";

/** A coach review of a completed week or block. */
export const reviewKindSchema = z.enum(["week", "block"]);

export type ReviewKind = z.infer<typeof reviewKindSchema>;

/**
 * The coach's summary of one completed week or block, plus the athlete's
 * comment and the coach's reply. Reviews are stored separately from the live
 * plan because the plan only keeps the current week and block.
 */
export const periodReviewSchema = z.object({
  kind: reviewKindSchema,
  startDate: planDateSchema,
  endDate: planDateSchema,
  /** A human-readable label, e.g. the block name or the week's focus. */
  title: z.string().min(1),
  summary: coachAnalysisSchema,
  /** The athlete's saved comment, if any. */
  comment: z.string().nullable().default(null),
  /** The coach's latest reply to the comment, if any. */
  coachReply: coachAnalysisSchema.nullable().default(null),
  /** The athlete dismissed the review with "No comment". */
  reviewed: z.boolean().default(false),
});

export type PeriodReview = z.infer<typeof periodReviewSchema>;

/** Response body of `GET /api/coaching/reviews`. */
export const periodReviewsResponseSchema = z.object({
  reviews: z.array(periodReviewSchema),
});

export type PeriodReviewsResponse = z.infer<typeof periodReviewsResponseSchema>;

/** Request body of the week/block review comment endpoints. */
export const periodReviewCommentRequestSchema = z.object({
  today: planDateSchema,
  timezone: z.string().min(1).max(100).optional(),
  comment: z.string().min(1).max(2000),
});

export type PeriodReviewCommentRequest = z.infer<
  typeof periodReviewCommentRequestSchema
>;
