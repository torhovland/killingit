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

export interface AdminQuestionsRouteDependencies {
  /** Injectable for route tests; default to the database-backed store. */
  listActiveQuestions?: typeof listActiveQuestions;
  reorderQuestions?: typeof reorderQuestions;
  createQuestion?: typeof createQuestion;
  addQuestionVersion?: typeof addQuestionVersion;
  archiveQuestion?: typeof archiveQuestion;
}

/**
 * Admin management of the versioned athlete question set. Editing appends a new
 * immutable version; deleting archives the question so historical versions
 * remain available to future answers and coach prompts.
 */
export function createAdminQuestionsRoute(
  deps: AdminQuestionsRouteDependencies = {},
): Hono {
  const list = deps.listActiveQuestions ?? listActiveQuestions;
  const reorder = deps.reorderQuestions ?? reorderQuestions;
  const create = deps.createQuestion ?? createQuestion;
  const addVersion = deps.addQuestionVersion ?? addQuestionVersion;
  const archive = deps.archiveQuestion ?? archiveQuestion;

  return new Hono()
    .get("/", async (c) => {
      const questions = await list();
      return c.json(
        questionsResponseSchema.parse({
          questions: questions.map(toQuestionResponse),
        }),
      );
    })
    .put("/order", zValidator("json", questionOrderInputSchema), async (c) => {
      const { ids } = c.req.valid("json");
      if (!(await reorder(ids))) {
        return badRequest(
          c,
          "Order must include every active question exactly once",
        );
      }
      const questions = await list();
      return c.json(
        questionsResponseSchema.parse({
          questions: questions.map(toQuestionResponse),
        }),
      );
    })
    .post("/", zValidator("json", questionInputSchema), async (c) => {
      const created = await create(c.req.valid("json"));
      return c.json(questionSchema.parse(toQuestionResponse(created)), 201);
    })
    .post(
      "/:id/versions",
      zValidator("param", questionIdParamSchema),
      zValidator("json", questionInputSchema),
      async (c) => {
        const { id } = c.req.valid("param");
        const updated = await addVersion(id, c.req.valid("json"));
        if (!updated) {
          return notFound(c, "Question not found");
        }
        return c.json(questionSchema.parse(toQuestionResponse(updated)));
      },
    )
    .delete("/:id", zValidator("param", questionIdParamSchema), async (c) => {
      const { id } = c.req.valid("param");
      if (!(await archive(id))) {
        return notFound(c, "Question not found");
      }
      return c.json(questionArchivedResponseSchema.parse({ id }));
    });
}
