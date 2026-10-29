import { z } from "zod";
import { coachAnalysisSchema } from "./llm.js";
import { planDateSchema } from "./plan.js";

/**
 * One clarification question the coach asked the athlete. The athlete answers
 * it on the main page, the coach replies, and the answered question is kept for
 * the season review. Only the newest unanswered question is shown at a time.
 */
export const coachQuestionSchema = z.object({
  id: z.number().int().positive(),
  question: z.string().min(1),
  answer: z.string().min(1).nullable(),
  coachReply: coachAnalysisSchema.nullable(),
  createdAt: z.string().datetime(),
  answeredAt: z.string().datetime().nullable(),
});

export type CoachQuestion = z.infer<typeof coachQuestionSchema>;

export const coachQuestionsResponseSchema = z.object({
  /** The newest unanswered question, or null when nothing is pending. */
  pending: coachQuestionSchema.nullable(),
  /** Answered questions, newest first, for the season review. */
  answered: z.array(coachQuestionSchema),
});

export type CoachQuestionsResponse = z.infer<
  typeof coachQuestionsResponseSchema
>;

export const coachQuestionAnswerRequestSchema = z.object({
  today: planDateSchema,
  timezone: z.string().min(1).max(100).optional(),
  answer: z.string().trim().min(1).max(2000),
});

export type CoachQuestionAnswerRequest = z.infer<
  typeof coachQuestionAnswerRequestSchema
>;
