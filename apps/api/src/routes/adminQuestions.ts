import {
  questionArchivedResponseSchema,
  questionInputSchema,
  questionSchema,
  questionsResponseSchema,
  type Question,
} from "@killingit/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  addQuestionVersion,
  archiveQuestion,
  createQuestion,
  listActiveQuestions,
  type StoredQuestion,
} from "../questions/store.js";

const questionIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Serializes dates; response schemas validate the rest. */
function toQuestionResponse(question: StoredQuestion): Question {
  return {
    id: question.id,
    versionId: question.versionId,
    prompt: question.prompt,
    required: question.required,
    version: question.version,
    versionCount: question.versionCount,
    createdAt: question.createdAt.toISOString(),
    updatedAt: question.updatedAt.toISOString(),
  };
}

/**
 * Admin management of the versioned athlete question set. Editing appends a new
 * immutable version; deleting archives the question so historical versions
 * remain available to future answers and coach prompts.
 */
export const adminQuestionsRoute = new Hono()
  .get("/", async (c) => {
    const questions = await listActiveQuestions();
    return c.json(
      questionsResponseSchema.parse({
        questions: questions.map(toQuestionResponse),
      }),
    );
  })
  .post("/", zValidator("json", questionInputSchema), async (c) => {
    const created = await createQuestion(c.req.valid("json"));
    return c.json(questionSchema.parse(toQuestionResponse(created)), 201);
  })
  .post(
    "/:id/versions",
    zValidator("param", questionIdParamSchema),
    zValidator("json", questionInputSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const updated = await addQuestionVersion(id, c.req.valid("json"));
      if (!updated) {
        return c.text("Question not found", 404);
      }
      return c.json(questionSchema.parse(toQuestionResponse(updated)));
    },
  )
  .delete("/:id", zValidator("param", questionIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    if (!(await archiveQuestion(id))) {
      return c.text("Question not found", 404);
    }
    return c.json(questionArchivedResponseSchema.parse({ id }));
  });
