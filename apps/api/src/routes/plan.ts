import {
  coachPlanResponseSchema,
  coachPlanSchema,
  planDateSchema,
  planGenerateInputSchema,
} from "@killingit/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getAthlete } from "../auth/middleware.js";
import {
  DEFAULT_ACTIVITIES,
  loadAnalyzedActivities,
  type ActivityFeed,
} from "../coaching/activities.js";
import { loadLlmClient, type LlmClient } from "../llm/client.js";
import { runPlanGeneration } from "../plans/generate.js";
import {
  latestAnswerTimestamp,
  planIsStale,
  planPending,
} from "../plans/status.js";
import type { PlanGenerationStore, PlanStore } from "../plans/store.js";
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
}

/**
 * Coach plan routes. GET reads the stored plan and reports what is missing for
 * the supplied date. POST runs the generation cascade; the UI calls it without
 * awaiting the response and polls GET for progress.
 */
export function createPlanRoute(deps: PlanRouteDependencies): Hono {
  const loadActivities =
    deps.loadActivities ??
    (() =>
      loadAnalyzedActivities({
        limit: DEFAULT_ACTIVITIES,
        refresh: false,
      }));
  const loadLlm = deps.loadLlm ?? loadLlmClient;

  async function buildResponse(
    userId: number,
    today: string,
    includeTomorrow = false,
  ) {
    const [storedPlan, generation, answers] = await Promise.all([
      deps.plans.load(userId),
      deps.generations.load(userId),
      deps.answers.listForUser(userId),
    ]);
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
        ? planIsStale(storedPlan.answersUpdatedAt, answersUpdatedAt)
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

        if (!(await deps.generations.begin(user.id))) {
          return c.json(await buildResponse(user.id, today), 202);
        }

        let plan: Awaited<ReturnType<PlanStore["load"]>>;
        let answers: Awaited<ReturnType<QuestionAnswerStore["listForUser"]>>;
        let activities: ActivityFeed;
        let llm: LlmClient | null;

        try {
          [plan, answers, activities, llm] = await Promise.all([
            deps.plans.load(user.id),
            deps.answers.listForUser(user.id),
            loadActivities(),
            loadLlm(),
          ]);
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "The plan could not be generated.";
          await deps.generations.fail(user.id, message);
          return c.text(message, 502);
        }

        if (!llm) {
          const message =
            "OpenRouter is not configured. Add a key and model first.";
          await deps.generations.fail(user.id, message);
          return c.text(message, 502);
        }

        // Run the long cascade after responding so the request cannot hit the
        // server idle timeout. The client polls GET for progress.
        void runPlanGeneration({
          userId: user.id,
          today,
          ...(timezone !== undefined ? { timezone } : {}),
          force,
          includeTomorrow,
          plan,
          context: {
            answers,
            answersUpdatedAt: latestAnswerTimestamp(answers),
            activities: activities.activities,
            provider: llm.provider,
            apiKey: llm.apiKey,
            model: llm.model,
          },
          plans: deps.plans,
          generations: deps.generations,
        }).catch((err: unknown) => {
          console.error("[plan] background generation failed:", err);
        });

        return c.json(
          await buildResponse(user.id, today, includeTomorrow),
          202,
        );
      },
    );
}
