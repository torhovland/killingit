import {
  coachQuestionAnswerRequestSchema,
  coachQuestionsResponseSchema,
  coachingInputSaveResponseSchema,
  quickQuestionRequestSchema,
  quickQuestionResponseSchema,
} from "@killingit/shared";
import type { Context } from "hono";
import { z } from "zod";
import { getAthlete } from "../../auth/middleware.js";
import { toCoachAnalysis } from "../../plans/replies.js";
import type { ResolvedCoachingDependencies } from "./dependencies.js";

type CoachQuestionAnswer = z.infer<typeof coachQuestionAnswerRequestSchema>;
type QuickQuestion = z.infer<typeof quickQuestionRequestSchema>;

/** Clarification questions from the coach and one-off questions to it. */
export function createCoachQuestionHandlers(
  deps: ResolvedCoachingDependencies,
) {
  return {
    async list(c: Context) {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const [pending, answered] = await Promise.all([
        deps.loadPendingQuestion(user.id),
        deps.loadAnsweredQuestions(user.id),
      ]);
      return c.json(coachQuestionsResponseSchema.parse({ pending, answered }));
    },

    async answer(c: Context, idParam: string, input: CoachQuestionAnswer) {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const id = Number(idParam);
      if (!Number.isInteger(id) || id <= 0) {
        return c.json({ message: "Invalid question" }, 400);
      }

      const question = await deps.loadQuestion(user.id, id);
      if (question === null) {
        return c.json({ message: "Question not found" }, 404);
      }
      if (question.answer !== null) {
        return c.json({ message: "Question already answered" }, 409);
      }

      const reply = await deps.replyToQuestion(
        { plans: deps.plans, answers: deps.answers, loadLlm: deps.llmLoader },
        {
          userId: user.id,
          today: input.today,
          question: question.question,
          answer: input.answer,
        },
      );
      const saved = await deps.answerCoachQuestionStore({
        userId: user.id,
        id,
        answer: input.answer,
        reply: reply?.text ?? null,
        replyModel: reply?.model ?? null,
      });
      if (saved === null) {
        return c.json({ message: "Question already answered" }, 409);
      }

      // Saving an answer is a new coach input, so it supersedes any in-flight
      // run. The run also answers activity comments that are still waiting
      // for their reply, so no pending "thinking" card is left behind.
      await deps.startRun(deps.coachRunDeps, {
        userId: user.id,
        today: input.today,
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        reply: true,
      });

      return c.json(
        coachingInputSaveResponseSchema.parse({
          message: "Answer saved",
          reply:
            reply === null
              ? null
              : {
                  text: reply.text,
                  model: reply.model,
                  generatedAt: reply.generatedAt.toISOString(),
                },
        }),
      );
    },

    async ask(c: Context, input: QuickQuestion) {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const { today, question } = input;

      const answer = await deps.answerQuestion(
        { plans: deps.plans, answers: deps.answers, loadLlm: deps.llmLoader },
        { userId: user.id, today, question },
      );

      return c.json(
        quickQuestionResponseSchema.parse({
          reply: answer === null ? null : toCoachAnalysis(answer),
        }),
      );
    },
  };
}
