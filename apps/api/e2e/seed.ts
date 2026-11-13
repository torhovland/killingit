import "./config.js";
import { db } from "../src/db/index.js";
import { llmModelSync, users } from "../src/db/schema.js";
import { makePlan, PLAN_WEEK_START } from "../integration/planFixture.js";
import { dbPlanStore } from "../src/plans/store.js";
import { dbQuestionAnswerStore } from "../src/questions/answers.js";
import { createQuestion } from "../src/questions/store.js";
import { truncateAllTables } from "../testDatabase/database.js";
import { E2E_ATHLETE_SUB } from "./config.js";

/** The state a journey starts from. */
export interface E2EState {
  userId: number;
  questionId: number;
  /** The date the browser must report as today through the dev override. */
  today: string;
}

export interface SeedOptions {
  /** Whether to seed a question, and whether the athlete has answered it. */
  questions?: "none" | "unanswered" | "answered";
  /** Whether to store the shared four-level plan fixture. */
  plan?: boolean;
  /** Whether the athlete has opted in to the food log. */
  dietAdvice?: boolean;
}

const QUESTION_PROMPT = "What are you training for this season?";

/** Clears every table, then seeds only the rows the requested journey needs. */
export async function seedE2eState(
  options: SeedOptions = {},
): Promise<E2EState> {
  const { questions = "answered", plan = false, dietAdvice = true } = options;

  await truncateAllTables();

  // A recent catalog check makes the dashboard's page-visit refresh a no-op,
  // so the suite never reaches OpenRouter.
  await db.insert(llmModelSync).values({ id: 1, lastCheckedAt: new Date() });

  const [user] = await db
    .insert(users)
    .values({
      authSubject: E2E_ATHLETE_SUB,
      role: "admin",
      timezone: "UTC",
      dietAdvice,
    })
    .returning();
  if (!user) {
    throw new Error("failed to seed the e2e athlete");
  }

  let questionId = 0;
  if (questions !== "none") {
    const question = await createQuestion({
      prompt: QUESTION_PROMPT,
      required: true,
    });
    questionId = question.id;

    if (questions === "answered") {
      const saved = await dbQuestionAnswerStore.saveAnswers(user.id, [
        {
          questionId: question.id,
          versionId: question.versionId,
          answer: "A fast autumn sportive, with time for recovery.",
        },
      ]);
      if (!saved) {
        throw new Error("failed to seed the e2e survey answer");
      }
    }
  }

  if (plan) {
    const stored = await dbPlanStore.save({
      userId: user.id,
      plan: makePlan(),
      answersUpdatedAt: questions === "answered" ? new Date() : null,
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
    });
    if (stored === null) {
      throw new Error("failed to seed the e2e plan");
    }
  }

  return { userId: user.id, questionId, today: PLAN_WEEK_START };
}
