import { z } from "zod";

/**
 * The editable content of a question version. Saving an edit creates a new
 * immutable version rather than changing the one athletes were shown.
 */
export const questionInputSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  required: z.boolean().default(true),
});

export type QuestionInput = z.infer<typeof questionInputSchema>;

/**
 * An active question with its current version. `versionId` identifies the exact
 * immutable `question_versions` row (future answers should pin it), `version` is
 * its number, and `versionCount` is how many versions exist in total.
 */
export const questionSchema = z.object({
  id: z.number().int().positive(),
  versionId: z.number().int().positive(),
  prompt: z.string(),
  required: z.boolean(),
  version: z.number().int().positive(),
  versionCount: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Question = z.infer<typeof questionSchema>;

/** Response body of `GET /api/admin/questions`. */
export const questionsResponseSchema = z.object({
  questions: z.array(questionSchema),
});

export type QuestionsResponse = z.infer<typeof questionsResponseSchema>;

/** Response body of `DELETE /api/admin/questions/:id`. */
export const questionArchivedResponseSchema = z.object({
  id: z.number().int().positive(),
});

export type QuestionArchivedResponse = z.infer<
  typeof questionArchivedResponseSchema
>;

/** The maximum length accepted for one free-text answer. */
export const QUESTION_ANSWER_MAX_LENGTH = 4000;

/**
 * One answer submitted by the signed-in athlete. `versionId` pins the exact
 * immutable wording the athlete was shown; the API rejects a version that is no
 * longer current rather than attaching the answer to different wording.
 *
 * A null answer explicitly skips an optional question. Required questions must
 * carry text.
 */
export const questionAnswerInputSchema = z.object({
  questionId: z.number().int().positive(),
  versionId: z.number().int().positive(),
  answer: z.string().trim().min(1).max(QUESTION_ANSWER_MAX_LENGTH).nullable(),
});

export type QuestionAnswerInput = z.infer<typeof questionAnswerInputSchema>;

/** Body of `POST /api/questions/answers`. Each question may appear once. */
export const questionAnswersInputSchema = z
  .object({
    answers: z.array(questionAnswerInputSchema).min(1).max(200),
  })
  .refine(
    (value) =>
      new Set(value.answers.map((entry) => entry.versionId)).size ===
      value.answers.length,
    {
      message: "Each question may be answered once",
      path: ["answers"],
    },
  );

export type QuestionAnswersInput = z.infer<typeof questionAnswersInputSchema>;

/**
 * An active question together with the signed-in athlete's response to its
 * current version. `answer` is null when the athlete has not answered this
 * version, and `skipped` is true when they explicitly left an optional question
 * blank.
 */
export const athleteQuestionSchema = questionSchema.extend({
  answer: z.string().nullable(),
  skipped: z.boolean(),
  answeredAt: z.string().datetime().nullable(),
});

export type AthleteQuestion = z.infer<typeof athleteQuestionSchema>;

/** Response body of the athlete question routes. */
export const athleteQuestionsResponseSchema = z.object({
  questions: z.array(athleteQuestionSchema),
  complete: z.boolean(),
});

export type AthleteQuestionsResponse = z.infer<
  typeof athleteQuestionsResponseSchema
>;

/**
 * The onboarding gate: every question must be resolved for its current version,
 * either with an answer or (when optional) an explicit skip. A required question
 * can never be completed by a skip.
 */
export function isQuestionnaireComplete(
  questions: readonly Pick<
    AthleteQuestion,
    "required" | "answer" | "skipped"
  >[],
): boolean {
  return questions.every(
    (question) =>
      question.answer !== null || (!question.required && question.skipped),
  );
}
