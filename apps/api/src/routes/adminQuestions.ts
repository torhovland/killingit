import {
  questionArchivedResponseSchema,
  questionInputSchema,
  questionOrderInputSchema,
  questionSchema,
  questionsResponseSchema,
} from "@killingit/shared";
import { zValidator } from "../http/validation.js";
import { Hono } from "hono";
import { z } from "zod";
import { badRequest, notFound } from "../http/errors.js";
import { toQuestionResponse } from "../questions/serializers.js";
import {
  addQuestionVersion,
  archiveQuestion,
  createQuestion,
  listActiveQuestions,
  reorderQuestions,
} from "../questions/store.js";

const questionIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

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
  .put("/order", zValidator("json", questionOrderInputSchema), async (c) => {
    const { ids } = c.req.valid("json");
    if (!(await reorderQuestions(ids))) {
      return badRequest(
        c,
        "Order must include every active question exactly once",
      );
    }
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
        return notFound(c, "Question not found");
      }
      return c.json(questionSchema.parse(toQuestionResponse(updated)));
    },
  )
  .delete("/:id", zValidator("param", questionIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    if (!(await archiveQuestion(id))) {
      return notFound(c, "Question not found");
    }
    return c.json(questionArchivedResponseSchema.parse({ id }));
  });
