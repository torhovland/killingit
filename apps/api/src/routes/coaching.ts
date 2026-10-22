import {
  activityCommentRequestSchema,
  analyzedActivitiesResponseSchema,
  manualActivityRequestSchema,
  weeklyNoteRequestSchema,
} from "@killingit/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getAthlete } from "../auth/middleware.js";
import {
  DEFAULT_ACTIVITIES,
  GarminCredentialsError,
  GarminNotConnectedError,
  LlmCredentialsError,
  loadAnalyzedActivities,
  MAX_ACTIVITIES,
  type ActivityFeed,
} from "../coaching/activities.js";
import { GarminAuthError, GarminSidecarError } from "../garmin/client.js";
import type { LlmClient } from "../llm/client.js";
import { LlmAuthError, LlmProviderError } from "../llm/openrouter.js";
import {
  saveActivityComment,
  saveManualActivity,
  saveWeeklyNote,
} from "../plans/inputs.js";
import type { CoachingInputs } from "../plans/inputs.js";
import type { PlanGenerationStore, PlanStore } from "../plans/store.js";
import { triggerPlanGeneration } from "../plans/trigger.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import type { UserStore } from "../users/store.js";

const querySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_ACTIVITIES)
    .default(DEFAULT_ACTIVITIES),
  refresh: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export interface CoachingRouteDependencies {
  users: UserStore;
  answers: QuestionAnswerStore;
  plans: PlanStore;
  generations: PlanGenerationStore;
  loadActivities?: () => Promise<ActivityFeed>;
  loadLlm?: () => Promise<LlmClient | null>;
  /** Injectable for route tests; defaults to the database-backed loader. */
  loadCoachingInputs?: (
    userId: number,
    weekStartDate: string,
  ) => Promise<CoachingInputs>;
  /** Injectable for route tests; default to the database-backed writers. */
  saveActivityComment?: typeof saveActivityComment;
  saveManualActivity?: typeof saveManualActivity;
  saveWeeklyNote?: typeof saveWeeklyNote;
  /** Injectable for route tests; defaults to the real plan generation trigger. */
  triggerPlanGeneration?: typeof triggerPlanGeneration;
}

/**
 * Coaching routes (ADR 0004). Syncs the operator's Garmin activities, analyses
 * the most recent ones with the configured LLM, and returns activity data plus
 * cached-or-fresh coach analysis. One failed analysis does not fail the batch.
 * Also accepts activity comments and manual activity logs, which automatically
 * trigger plan generation when the plan is already established.
 */
export function createCoachingRoute(deps: CoachingRouteDependencies): Hono {
  const loadActivities =
    deps.loadActivities ??
    (() =>
      loadAnalyzedActivities({ limit: DEFAULT_ACTIVITIES, refresh: false }));
  const saveComment = deps.saveActivityComment ?? saveActivityComment;
  const saveManual = deps.saveManualActivity ?? saveManualActivity;
  const saveWeekly = deps.saveWeeklyNote ?? saveWeeklyNote;
  const trigger = deps.triggerPlanGeneration ?? triggerPlanGeneration;

  return new Hono()
    .get("/activities", async (c) => {
      const query = querySchema.safeParse(c.req.query());
      if (!query.success) {
        return c.text("Invalid query parameters", 400);
      }

      try {
        const feed = await loadActivities();
        return c.json(analyzedActivitiesResponseSchema.parse(feed));
      } catch (err) {
        if (err instanceof GarminNotConnectedError) {
          return c.text(err.message, 401);
        }
        if (err instanceof GarminAuthError) {
          return c.text(err.message, 401);
        }
        if (err instanceof GarminSidecarError && err.status) {
          c.status(err.status as 401 | 403 | 429 | 502);
          return c.text(err.message);
        }
        if (
          err instanceof GarminCredentialsError ||
          err instanceof LlmCredentialsError
        ) {
          console.error(`[coaching] ${err.message}`);
          return c.text(err.message, 503);
        }
        if (err instanceof LlmAuthError) {
          return c.text(err.message, 401);
        }
        if (err instanceof LlmProviderError) {
          return c.text(err.message, 503);
        }
        console.error("[coaching] activity feed failure:", err);
        return c.text("Service Unavailable", 503);
      }
    })
    .post(
      "/activities/:activityId/comments",
      zValidator("json", activityCommentRequestSchema),
      async (c) => {
        const user = await deps.users.ensureUser(getAthlete(c).sub);
        const { activityId } = c.req.param();
        const { today, timezone, comment } = c.req.valid("json");

        await saveComment(user.id, { activityId, comment });

        await trigger(
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
          },
        );

        return c.json({ message: "Comment saved" });
      },
    )
    .post(
      "/activities/manual",
      zValidator("json", manualActivityRequestSchema),
      async (c) => {
        const user = await deps.users.ensureUser(getAthlete(c).sub);
        const { today, timezone, ...activity } = c.req.valid("json");

        await saveManual(user.id, activity);

        await trigger(
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
          },
        );

        return c.json({ message: "Manual activity saved" });
      },
    )
    .post(
      "/weekly/notes",
      zValidator("json", weeklyNoteRequestSchema),
      async (c) => {
        const user = await deps.users.ensureUser(getAthlete(c).sub);
        const { today, timezone, note } = c.req.valid("json");

        await saveWeekly(user.id, today, note);

        await trigger(
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
          },
        );

        return c.json({ message: "Weekly note saved" });
      },
    );
}
