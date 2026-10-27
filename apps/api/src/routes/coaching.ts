import {
  activityCommentRequestSchema,
  analyzedActivitiesResponseSchema,
  coachingInputSaveResponseSchema,
  manualActivitiesResponseSchema,
  manualActivityRequestSchema,
  periodReviewCommentRequestSchema,
  periodReviewsResponseSchema,
  planDateSchema,
  quickQuestionRequestSchema,
  quickQuestionResponseSchema,
  reviewKindSchema,
  weeklyNoteRequestSchema,
  weeklyNoteResponseSchema,
  type ActivityCommentRequest,
  type PeriodReview,
  type ReviewKind,
} from "@killingit/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { getAthlete } from "../auth/middleware.js";
import {
  DEFAULT_ACTIVITIES,
  GarminCredentialsError,
  GarminNotConnectedError,
  LlmCredentialsError,
  loadAnalyzedActivities,
  loadUserActivityTrainingLoads,
  MAX_ACTIVITIES,
  type ActivityFeed,
} from "../coaching/activities.js";
import {
  deleteImportedActivity,
  deleteManualActivity,
} from "../coaching/deletions.js";
import { loadCachedActivityFeed } from "../coaching/feedCache.js";
import {
  answerCoachingQuestion,
  replyToCoachingInput,
  type CoachingReplyRequest,
} from "../coaching/replies.js";
import { saveActivityReview } from "../coaching/reviews.js";
import { GarminAuthError, GarminSidecarError } from "../garmin/client.js";
import { loadLlmClient, type LlmClient } from "../llm/client.js";
import { LlmAuthError, LlmProviderError } from "../llm/openrouter.js";
import { startOfWeek } from "../plans/dates.js";
import { latestActivityAnalysisTimestamp } from "../plans/status.js";
import {
  createActivityComment,
  loadManualActivities,
  loadWeeklyNote,
  saveManualActivity,
  saveWeeklyNote,
  updateActivityComment,
  updateManualActivity,
} from "../plans/inputs.js";
import type { CoachingInputs } from "../plans/inputs.js";
import {
  createPeriodReviewComment,
  loadPeriodReview,
  loadPeriodReviews,
  markPeriodReviewReviewed,
  toPeriodReview,
  updatePeriodReviewComment,
} from "../plans/periodReviews.js";
import {
  loadManualActivityReplies,
  loadWeeklyNoteReply,
  toCoachAnalysis,
} from "../plans/replies.js";
import type { PlanGenerationStore, PlanStore } from "../plans/store.js";
import {
  triggerPlanGeneration,
  type PlanTriggerDependencies,
} from "../plans/trigger.js";
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
  /** Supplied by the dashboard so a new analysis can refresh the plan. */
  today: planDateSchema.optional(),
  timezone: z.string().min(1).max(100).optional(),
});

const deletionQuerySchema = z.object({
  today: planDateSchema,
  timezone: z.string().min(1).max(100).optional(),
});

export interface CoachingRouteDependencies {
  users: UserStore;
  answers: QuestionAnswerStore;
  plans: PlanStore;
  generations: PlanGenerationStore;
  loadActivities?: (userId: number) => Promise<ActivityFeed>;
  /** Injectable for route tests; defaults to the stored feed reader. */
  loadCachedFeed?: typeof loadCachedActivityFeed;
  /** Injectable for route tests; defaults to the training-load builder. */
  loadActivityTrainingLoads?: typeof loadUserActivityTrainingLoads;
  loadLlm?: (userId: number) => Promise<LlmClient | null>;
  /** Injectable for route tests; defaults to the database-backed loader. */
  loadCoachingInputs?: (
    userId: number,
    weekStartDate: string,
  ) => Promise<CoachingInputs>;
  /** Injectable for route tests; default to the database-backed writers. */
  loadWeeklyNote?: typeof loadWeeklyNote;
  loadManualActivities?: typeof loadManualActivities;
  loadManualActivityReplies?: typeof loadManualActivityReplies;
  loadWeeklyNoteReply?: typeof loadWeeklyNoteReply;
  createActivityComment?: typeof createActivityComment;
  updateActivityComment?: typeof updateActivityComment;
  saveActivityReview?: typeof saveActivityReview;
  loadPeriodReviews?: typeof loadPeriodReviews;
  loadPeriodReview?: typeof loadPeriodReview;
  createPeriodReviewComment?: typeof createPeriodReviewComment;
  updatePeriodReviewComment?: typeof updatePeriodReviewComment;
  markPeriodReviewReviewed?: typeof markPeriodReviewReviewed;
  saveManualActivity?: typeof saveManualActivity;
  saveWeeklyNote?: typeof saveWeeklyNote;
  updateManualActivity?: typeof updateManualActivity;
  deleteImportedActivity?: typeof deleteImportedActivity;
  deleteManualActivity?: typeof deleteManualActivity;
  /** Injectable for route tests; defaults to the real coach reply generator. */
  replyToCoachingInput?: typeof replyToCoachingInput;
  /** Injectable for route tests; defaults to the real one-off question answer. */
  answerCoachingQuestion?: typeof answerCoachingQuestion;
  /** Injectable for route tests; defaults to the real plan generation trigger. */
  triggerPlanGeneration?: typeof triggerPlanGeneration;
  /** Injectable for route tests; defaults to Open-Meteo. */
  loadForecast?: PlanTriggerDependencies["loadForecast"];
}

/**
 * Coaching routes (ADR 0004). Syncs the signed-in athlete's Garmin activities,
 * analyses
 * the most recent ones with the configured LLM, and returns activity data plus
 * cached-or-fresh coach analysis. Also accepts activity comments and manual
 * activity logs, replies to them briefly, and triggers a plan revision when the
 * plan is already established.
 */
export function createCoachingRoute(deps: CoachingRouteDependencies): Hono {
  const loadActivities =
    deps.loadActivities ??
    ((userId) =>
      loadAnalyzedActivities({
        userId,
        limit: DEFAULT_ACTIVITIES,
        refresh: false,
      }));
  const loadCachedFeed = deps.loadCachedFeed ?? loadCachedActivityFeed;
  const loadActivityTrainingLoads =
    deps.loadActivityTrainingLoads ?? loadUserActivityTrainingLoads;
  const createComment = deps.createActivityComment ?? createActivityComment;
  const updateComment = deps.updateActivityComment ?? updateActivityComment;
  const saveReview = deps.saveActivityReview ?? saveActivityReview;
  const loadReviews = deps.loadPeriodReviews ?? loadPeriodReviews;
  const loadReview = deps.loadPeriodReview ?? loadPeriodReview;
  const createReviewComment =
    deps.createPeriodReviewComment ?? createPeriodReviewComment;
  const updateReviewComment =
    deps.updatePeriodReviewComment ?? updatePeriodReviewComment;
  const markReviewReviewed =
    deps.markPeriodReviewReviewed ?? markPeriodReviewReviewed;
  const saveManual = deps.saveManualActivity ?? saveManualActivity;
  const saveWeekly = deps.saveWeeklyNote ?? saveWeeklyNote;
  const loadNote = deps.loadWeeklyNote ?? loadWeeklyNote;
  const loadNoteReply = deps.loadWeeklyNoteReply ?? loadWeeklyNoteReply;
  const loadManual = deps.loadManualActivities ?? loadManualActivities;
  const loadManualReplies =
    deps.loadManualActivityReplies ?? loadManualActivityReplies;
  const updateManual = deps.updateManualActivity ?? updateManualActivity;
  const deleteImported = deps.deleteImportedActivity ?? deleteImportedActivity;
  const deleteManual = deps.deleteManualActivity ?? deleteManualActivity;
  const reply = deps.replyToCoachingInput ?? replyToCoachingInput;
  const answerQuestion = deps.answerCoachingQuestion ?? answerCoachingQuestion;
  const trigger = deps.triggerPlanGeneration ?? triggerPlanGeneration;
  const llmLoader = deps.loadLlm ?? loadLlmClient;

  const triggerDeps: PlanTriggerDependencies = {
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
    ...(deps.loadForecast !== undefined
      ? { loadForecast: deps.loadForecast }
      : {}),
  };

  async function replyTo(
    userId: number,
    today: string,
    request: CoachingReplyRequest,
  ) {
    const stored = await reply(
      { plans: deps.plans, answers: deps.answers, loadLlm: llmLoader },
      { userId, today, request },
    );
    return stored === null ? null : toCoachAnalysis(stored);
  }

  /**
   * Saves the activity's single comment, regenerates its coach reply, and
   * starts a plan revision. `create` refuses to replace an existing comment;
   * `edit` requires one to exist.
   */
  async function saveActivityComment(
    c: Context,
    mode: "create" | "edit",
    user: { id: number },
    activityId: string,
    input: ActivityCommentRequest,
  ) {
    const { today, timezone, activityDate, comment } = input;

    const saved =
      mode === "create"
        ? await createComment(user.id, { activityId, comment })
        : await updateComment(user.id, { activityId, comment });
    if (!saved) {
      return c.text(
        mode === "create"
          ? "This activity already has a comment; edit it instead"
          : "This activity has no comment to edit",
        mode === "create" ? 409 : 404,
      );
    }

    const coachReply = await replyTo(user.id, today, {
      kind: "activity_comment",
      activityId,
      activityDate,
      comment,
    });

    await trigger(triggerDeps, {
      userId: user.id,
      today,
      ...(timezone !== undefined ? { timezone } : {}),
      keepToday: activityDate === today,
    });

    return c.json(
      coachingInputSaveResponseSchema.parse({
        message: mode === "create" ? "Comment saved" : "Comment updated",
        reply: coachReply,
      }),
    );
  }

  /**
   * Saves a comment on a completed week or block, generates the coach's reply
   * to it, and starts a plan revision. `create` refuses to replace an existing
   * comment; `edit` requires one to exist.
   */
  async function savePeriodReviewComment(
    c: Context,
    mode: "create" | "edit",
    user: { id: number },
    kind: ReviewKind,
    startDate: string,
    input: { today: string; timezone?: string | undefined; comment: string },
  ) {
    const review = await loadReview(user.id, kind, startDate);
    if (review === null) {
      return c.text("Review not found", 404);
    }

    const saved =
      mode === "create"
        ? await createReviewComment(user.id, kind, startDate, input.comment)
        : await updateReviewComment(user.id, kind, startDate, input.comment);
    if (!saved) {
      return c.text(
        mode === "create"
          ? "This review already has a comment; edit it instead"
          : "This review has no comment to edit",
        mode === "create" ? 409 : 404,
      );
    }

    const coachReply = await replyTo(user.id, input.today, {
      kind: kind === "week" ? "week_review" : "block_review",
      startDate: review.startDate,
      endDate: review.endDate,
      summary: review.summary,
      comment: input.comment,
    });

    await trigger(triggerDeps, {
      userId: user.id,
      today: input.today,
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    });

    return c.json(
      coachingInputSaveResponseSchema.parse({
        message: mode === "create" ? "Review comment saved" : "Review updated",
        reply: coachReply,
      }),
    );
  }

  /**
   * Starts a plan revision when the feed contains an analysis produced after
   * the stored plan was saved. The already-synced feed is reused so the trigger
   * does not hit Garmin again. A failure here must not break the activity list.
   */
  async function refreshPlanAfterAnalysis(
    userId: number,
    feed: ActivityFeed,
    today: string | undefined,
    timezone: string | undefined,
  ): Promise<void> {
    if (today === undefined) {
      return;
    }
    try {
      const stored = await deps.plans.load(userId);
      const analysedAt = latestActivityAnalysisTimestamp(feed.activities);
      if (
        stored === null ||
        analysedAt === null ||
        (stored.activitiesUpdatedAt !== null &&
          analysedAt.getTime() <= stored.activitiesUpdatedAt.getTime())
      ) {
        return;
      }
      await trigger(
        { ...triggerDeps, loadActivities: () => Promise.resolve(feed) },
        {
          userId,
          today,
          ...(timezone !== undefined ? { timezone } : {}),
        },
      );
    } catch (err) {
      console.error(
        "[coaching] could not refresh the plan after analysis:",
        err,
      );
    }
  }

  return new Hono()
    .get("/activities/cached", async (c) => {
      try {
        const user = await deps.users.ensureUser(getAthlete(c).sub);
        const feed = await loadCachedFeed(user.id);
        return c.json(
          analyzedActivitiesResponseSchema.parse(
            feed ?? { model: null, activities: [] },
          ),
        );
      } catch (err) {
        console.error("[coaching] cached activity feed failure:", err);
        return c.text("Service Unavailable", 503);
      }
    })
    .get("/activities", async (c) => {
      const query = querySchema.safeParse(c.req.query());
      if (!query.success) {
        return c.text("Invalid query parameters", 400);
      }

      try {
        const user = await deps.users.ensureUser(getAthlete(c).sub);
        const feed = await loadActivities(user.id);
        await refreshPlanAfterAnalysis(
          user.id,
          feed,
          query.data.today,
          query.data.timezone,
        );
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
        return saveActivityComment(
          c,
          "create",
          user,
          activityId,
          c.req.valid("json"),
        );
      },
    )
    .put(
      "/activities/:activityId/comments",
      zValidator("json", activityCommentRequestSchema),
      async (c) => {
        const user = await deps.users.ensureUser(getAthlete(c).sub);
        const { activityId } = c.req.param();
        return saveActivityComment(
          c,
          "edit",
          user,
          activityId,
          c.req.valid("json"),
        );
      },
    )
    .post("/activities/:activityId/reviewed", async (c) => {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const { activityId } = c.req.param();

      await saveReview(user.id, activityId);
      return c.json(
        coachingInputSaveResponseSchema.parse({
          message: "Activity acknowledged",
        }),
      );
    })
    .get("/reviews", async (c) => {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const entries = await loadReviews(user.id);
      const reviews: PeriodReview[] = entries
        .map(toPeriodReview)
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
      return c.json(periodReviewsResponseSchema.parse({ reviews }));
    })
    .post(
      "/reviews/:kind/:startDate/comments",
      zValidator("json", periodReviewCommentRequestSchema),
      async (c) => {
        const user = await deps.users.ensureUser(getAthlete(c).sub);
        const kind = reviewKindSchema.safeParse(c.req.param("kind"));
        const startDate = planDateSchema.safeParse(c.req.param("startDate"));
        if (!kind.success || !startDate.success) {
          return c.text("Invalid review", 400);
        }
        return savePeriodReviewComment(
          c,
          "create",
          user,
          kind.data,
          startDate.data,
          c.req.valid("json"),
        );
      },
    )
    .put(
      "/reviews/:kind/:startDate/comments",
      zValidator("json", periodReviewCommentRequestSchema),
      async (c) => {
        const user = await deps.users.ensureUser(getAthlete(c).sub);
        const kind = reviewKindSchema.safeParse(c.req.param("kind"));
        const startDate = planDateSchema.safeParse(c.req.param("startDate"));
        if (!kind.success || !startDate.success) {
          return c.text("Invalid review", 400);
        }
        return savePeriodReviewComment(
          c,
          "edit",
          user,
          kind.data,
          startDate.data,
          c.req.valid("json"),
        );
      },
    )
    .post("/reviews/:kind/:startDate/reviewed", async (c) => {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const kind = reviewKindSchema.safeParse(c.req.param("kind"));
      const startDate = planDateSchema.safeParse(c.req.param("startDate"));
      if (!kind.success || !startDate.success) {
        return c.text("Invalid review", 400);
      }
      const updated = await markReviewReviewed(
        user.id,
        kind.data,
        startDate.data,
      );
      if (!updated) {
        return c.text("Review not found", 404);
      }
      return c.json(
        coachingInputSaveResponseSchema.parse({
          message: "Review acknowledged",
        }),
      );
    })
    .delete("/activities/:activityId", async (c) => {
      const query = deletionQuerySchema.safeParse(c.req.query());
      if (!query.success) {
        return c.text("A valid today date (YYYY-MM-DD) is required", 400);
      }

      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const { activityId } = c.req.param();
      const { today, timezone } = query.data;

      await deleteImported(user.id, activityId);
      await trigger(triggerDeps, {
        userId: user.id,
        today,
        ...(timezone !== undefined ? { timezone } : {}),
      });

      return c.json(
        coachingInputSaveResponseSchema.parse({
          message: "Activity deleted",
        }),
      );
    })
    .get("/activities/manual", async (c) => {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const [activities, replies, cached, storedPlan] = await Promise.all([
        loadManual(user.id),
        loadManualReplies(user.id),
        loadCachedFeed(user.id),
        deps.plans.load(user.id),
      ]);
      const loads = await loadActivityTrainingLoads(
        user.id,
        cached?.activities ?? [],
        storedPlan?.plan,
        activities.map((activity) => activity.startDate),
      );
      return c.json(
        manualActivitiesResponseSchema.parse({
          manualActivities: activities.map((activity) => {
            const stored = replies.get(activity.id);
            return {
              ...activity,
              coachReply: stored ? toCoachAnalysis(stored) : null,
              trainingLoad: loads.get(activity.startDate) ?? null,
            };
          }),
        }),
      );
    })
    .post(
      "/activities/manual",
      zValidator("json", manualActivityRequestSchema),
      async (c) => {
        const user = await deps.users.ensureUser(getAthlete(c).sub);
        const { today, timezone, ...activity } = c.req.valid("json");

        const id = await saveManual(user.id, activity);
        const coachReply = await replyTo(user.id, today, {
          kind: "manual_activity",
          manualActivityId: id,
          startDate: activity.startDate,
          details: activity.details,
        });

        await trigger(triggerDeps, {
          userId: user.id,
          today,
          ...(timezone !== undefined ? { timezone } : {}),
          keepToday: activity.startDate === today,
        });

        return c.json(
          coachingInputSaveResponseSchema.parse({
            message: "Manual activity saved",
            reply: coachReply,
          }),
        );
      },
    )
    .put(
      "/activities/manual/:id",
      zValidator("json", manualActivityRequestSchema),
      async (c) => {
        const user = await deps.users.ensureUser(getAthlete(c).sub);
        const id = Number(c.req.param("id"));
        if (Number.isNaN(id)) {
          return c.text("Invalid manual activity id", 400);
        }
        const { today, timezone, ...activity } = c.req.valid("json");

        const updated = await updateManual(user.id, id, activity);
        if (!updated) {
          return c.text("Manual activity not found", 404);
        }

        const coachReply = await replyTo(user.id, today, {
          kind: "manual_activity",
          manualActivityId: id,
          startDate: activity.startDate,
          details: activity.details,
        });

        await trigger(triggerDeps, {
          userId: user.id,
          today,
          ...(timezone !== undefined ? { timezone } : {}),
          keepToday: activity.startDate === today,
        });

        return c.json(
          coachingInputSaveResponseSchema.parse({
            message: "Manual activity updated",
            reply: coachReply,
          }),
        );
      },
    )
    .delete("/activities/manual/:id", async (c) => {
      const query = deletionQuerySchema.safeParse(c.req.query());
      if (!query.success) {
        return c.text("A valid today date (YYYY-MM-DD) is required", 400);
      }

      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const id = Number(c.req.param("id"));
      if (Number.isNaN(id)) {
        return c.text("Invalid manual activity id", 400);
      }
      const { today, timezone } = query.data;

      const deleted = await deleteManual(user.id, id);
      if (!deleted) {
        return c.text("Manual activity not found", 404);
      }

      await trigger(triggerDeps, {
        userId: user.id,
        today,
        ...(timezone !== undefined ? { timezone } : {}),
      });

      return c.json(
        coachingInputSaveResponseSchema.parse({
          message: "Manual activity deleted",
        }),
      );
    })
    .post(
      "/questions",
      zValidator("json", quickQuestionRequestSchema),
      async (c) => {
        const user = await deps.users.ensureUser(getAthlete(c).sub);
        const { today, question } = c.req.valid("json");

        const answer = await answerQuestion(
          { plans: deps.plans, answers: deps.answers, loadLlm: llmLoader },
          { userId: user.id, today, question },
        );

        return c.json(
          quickQuestionResponseSchema.parse({
            reply: answer === null ? null : toCoachAnalysis(answer),
          }),
        );
      },
    )
    .get("/weekly/notes", async (c) => {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const today = planDateSchema.safeParse(c.req.query("today"));
      if (!today.success) {
        return c.text("A valid today date (YYYY-MM-DD) is required", 400);
      }
      const weekStartDate = startOfWeek(today.data);
      const [note, storedReply] = await Promise.all([
        loadNote(user.id, weekStartDate),
        loadNoteReply(user.id, weekStartDate),
      ]);
      return c.json(
        weeklyNoteResponseSchema.parse({
          note,
          reply: storedReply ? toCoachAnalysis(storedReply) : null,
        }),
      );
    })
    .post(
      "/weekly/notes",
      zValidator("json", weeklyNoteRequestSchema),
      async (c) => {
        const user = await deps.users.ensureUser(getAthlete(c).sub);
        const { today, timezone, note } = c.req.valid("json");

        await saveWeekly(user.id, today, note);
        const coachReply = await replyTo(user.id, today, {
          kind: "weekly_note",
          weekStartDate: startOfWeek(today),
          note,
        });

        await trigger(triggerDeps, {
          userId: user.id,
          today,
          ...(timezone !== undefined ? { timezone } : {}),
        });

        return c.json(
          coachingInputSaveResponseSchema.parse({
            message: "Weekly note saved",
            reply: coachReply,
          }),
        );
      },
    );
}
