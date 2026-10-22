import {
  coachPlanResponseSchema,
  coachPlanSchema,
  planDateSchema,
  planGenerateInputSchema,
} from "@killingit/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getAthlete } from "../auth/middleware.js";
import type { ActivityFeed } from "../coaching/activities.js";
import type { LlmClient } from "../llm/client.js";
import { startOfWeek } from "../plans/dates.js";
import { loadCoachingInputs, type CoachingInputs } from "../plans/inputs.js";
import {
  latestAnswerTimestamp,
  planIsStale,
  planPending,
} from "../plans/status.js";
import type { PlanGenerationStore, PlanStore } from "../plans/store.js";
import { triggerPlanGeneration } from "../plans/trigger.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import type { UserStore } from "../users/store.js";

export interface PlanRouteDependencies {
  users: UserStore;
  answers: QuestionAnswerStore;
  plans: PlanStore;
  generations: PlanGenerationStore;
  /** Injectable for route tests; defaults to a Garmin sync. */
  loadActivities?: () => Promise<ActivityFeed>;
  /** Injectable for route tests; defaults to the stored OpenRouter config. */
  loadLlm?: () => Promise<LlmClient | null>;
  /** Injectable for route tests; defaults to the database-backed loader. */
  loadCoachingInputs?: (
    userId: number,
    weekStartDate: string,
  ) => Promise<CoachingInputs>;
}

/**
 * Coach plan routes. GET reads the stored plan and reports what is missing for
 * the supplied date. POST runs the generation cascade; the UI calls it without
 * awaiting the response and polls GET for progress.
 */
export function createPlanRoute(deps: PlanRouteDependencies): Hono {
  async function buildResponse(
    userId: number,
    today: string,
    includeTomorrow = false,
  ) {
    const [storedPlan, generation, answers, coachingInputs] = await Promise.all(
      [
        deps.plans.load(userId),
        deps.generations.load(userId),
        deps.answers.listForUser(userId),
        deps.loadCoachingInputs
          ? deps.loadCoachingInputs(userId, startOfWeek(today))
          : loadCoachingInputs(userId, startOfWeek(today)),
      ],
    );
    const answersUpdatedAt = latestAnswerTimestamp(answers);

    // A plan saved under an older schema (or a partial write) must not crash
    // the endpoint. Treat it as absent so the client can regenerate it.
    const parsed = storedPlan
      ? coachPlanSchema.safeParse(storedPlan.plan)
      : null;
    const plan = parsed?.success ? parsed.data : null;
    const generatedAt =
      storedPlan && parsed?.success
        ? storedPlan.generatedAt.toISOString()
        : null;
    const stale =
      storedPlan && parsed?.success
        ? planIsStale(storedPlan.answersUpdatedAt, answersUpdatedAt) ||
          planIsStale(
            storedPlan.coachingInputsUpdatedAt,
            coachingInputs.updatedAt,
          )
        : false;

    return coachPlanResponseSchema.parse({
      plan,
      generatedAt,
      generation,
      stale,
      pending: planPending(plan, today, includeTomorrow),
    });
  }

  return new Hono()
    .get("/", async (c) => {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const today = planDateSchema.safeParse(c.req.query("today"));
      if (!today.success) {
        return c.text("A valid today date (YYYY-MM-DD) is required", 400);
      }
      const includeTomorrow = c.req.query("includeTomorrow") === "true";
      return c.json(await buildResponse(user.id, today.data, includeTomorrow));
    })
    .post(
      "/generate",
      zValidator("json", planGenerateInputSchema),
      async (c) => {
        const user = await deps.users.ensureUser(getAthlete(c).sub);
        const { today, timezone, force, includeTomorrow } = c.req.valid("json");

        const started = await triggerPlanGeneration(
          {
            users: deps.users,
            answers: deps.answers,
            plans: deps.plans,
            generations: deps.generations,
            ...(deps.loadActivities !== undefined
              ? { loadActivities: deps.loadActivities }
              : {}),
            ...(deps.loadLlm !== undefined ? { loadLlm: deps.loadLlm } : {}),
            ...(deps.loadCoachingInputs !== undefined
              ? { loadCoachingInputs: deps.loadCoachingInputs }
              : {}),
          },
          {
            userId: user.id,
            today,
            ...(timezone !== undefined ? { timezone } : {}),
            force,
            includeTomorrow,
          },
        );

        if (!started) {
          return c.json(await buildResponse(user.id, today), 202);
        }

        return c.json(
          await buildResponse(user.id, today, includeTomorrow),
          202,
        );
      },
    );
}
