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
