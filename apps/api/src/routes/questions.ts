import {
  athleteQuestionsResponseSchema,
  isQuestionnaireComplete,
  questionAnswersInputSchema,
} from "@killingit/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getAthlete } from "../auth/middleware.js";
import {
  type QuestionAnswerStore,
  type StoredAthleteQuestion,
} from "../questions/answers.js";
import { toAthleteQuestionResponse } from "../questions/serializers.js";
import type { UserStore } from "../users/store.js";

export interface QuestionsRouteDependencies {
  users: UserStore;
  answers: QuestionAnswerStore;
}

function toQuestionsResponse(questions: StoredAthleteQuestion[]) {
  return athleteQuestionsResponseSchema.parse({
    questions: questions.map(toAthleteQuestionResponse),
    complete: isQuestionnaireComplete(questions),
  });
}

/**
 * Athlete-facing question set. Reads and writes are scoped to the signed-in
 * user's account; answers are pinned to the current question version so an
 * admin edit re-asks the question instead of applying old wording (ADR 0007).
 */
export function createQuestionsRoute({
  users,
  answers,
}: QuestionsRouteDependencies): Hono {
  return new Hono()
    .get("/", async (c) => {
      const user = await users.ensureUser(getAthlete(c).sub);
      return c.json(toQuestionsResponse(await answers.listForUser(user.id)));
    })
    .post(
      "/answers",
      zValidator("json", questionAnswersInputSchema),
      async (c) => {
        const user = await users.ensureUser(getAthlete(c).sub);
        const { answers: submitted } = c.req.valid("json");

        if (!(await answers.saveAnswers(user.id, submitted))) {
          return c.text(
            "One or more answers are missing or no longer current. Please review and try again.",
            400,
          );
        }

        return c.json(toQuestionsResponse(await answers.listForUser(user.id)));
      },
    );
}
