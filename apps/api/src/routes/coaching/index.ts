import {
  activityCommentRequestSchema,
  coachQuestionAnswerRequestSchema,
  idParamSchema,
  manualActivityRequestSchema,
  periodReviewCommentRequestSchema,
  quickQuestionRequestSchema,
  weeklyNoteRequestSchema,
} from "@killingit/shared";
import { zValidator } from "../../http/validation.js";
import { Hono } from "hono";
import type { ResolvedAppDependencies } from "../../dependencies.js";
import { createCoachQuestionHandlers } from "./coachQuestions.js";
import { createCommentHandlers } from "./comments.js";
import { resolveCoachingDependencies } from "./dependencies.js";
import { createFeedHandlers } from "./feed.js";
import { createManualActivityHandlers } from "./manualActivities.js";
import { createReviewHandlers } from "./reviews.js";
import { activityIdParamSchema, reviewParamSchema } from "./schemas.js";
import { createWeeklyNoteHandlers } from "./weeklyNotes.js";

/**
 * Coaching routes (ADR 0004). Syncs the signed-in athlete's Garmin activities,
 * analyses the most recent ones with the configured LLM, and returns activity
 * data plus cached-or-fresh coach analysis. Also accepts activity comments and
 * manual activity logs, replies to them briefly, and triggers a plan revision
 * when the plan is already established.
 */
export function createCoachingRoute(deps: ResolvedAppDependencies): Hono {
  const resolved = resolveCoachingDependencies(deps);
  const feed = createFeedHandlers(resolved);
  const comments = createCommentHandlers(resolved);
  const reviews = createReviewHandlers(resolved);
  const manual = createManualActivityHandlers(resolved);
  const questions = createCoachQuestionHandlers(resolved);
  const notes = createWeeklyNoteHandlers(resolved);

  return new Hono()
    .get("/activities/cached", async (c) => feed.cached(c))
    .get("/activities", async (c) => feed.activities(c))
    .post(
      "/activities/:activityId/comments",
      zValidator("param", activityIdParamSchema),
      zValidator("json", activityCommentRequestSchema),
      async (c) => {
        const { activityId } = c.req.valid("param");
        return comments.save(c, "create", activityId, c.req.valid("json"));
      },
    )
    .put(
      "/activities/:activityId/comments",
      zValidator("param", activityIdParamSchema),
      zValidator("json", activityCommentRequestSchema),
      async (c) => {
        const { activityId } = c.req.valid("param");
        return comments.save(c, "edit", activityId, c.req.valid("json"));
      },
    )
    .post(
      "/activities/:activityId/reviewed",
      zValidator("param", activityIdParamSchema),
      async (c) => comments.reviewed(c, c.req.valid("param").activityId),
    )
    .get("/coach-questions", async (c) => questions.list(c))
    .post(
      "/coach-questions/:id/answer",
      zValidator("param", idParamSchema),
      zValidator("json", coachQuestionAnswerRequestSchema),
      async (c) =>
        questions.answer(c, c.req.valid("param").id, c.req.valid("json")),
    )
    .get("/reviews", async (c) => reviews.list(c))
    .post(
      "/reviews/:kind/:startDate/comments",
      zValidator("param", reviewParamSchema),
      zValidator("json", periodReviewCommentRequestSchema),
      async (c) => {
        const review = c.req.valid("param");
        return reviews.save(c, "create", review, c.req.valid("json"));
      },
    )
    .put(
      "/reviews/:kind/:startDate/comments",
      zValidator("param", reviewParamSchema),
      zValidator("json", periodReviewCommentRequestSchema),
      async (c) => {
        const review = c.req.valid("param");
        return reviews.save(c, "edit", review, c.req.valid("json"));
      },
    )
    .post(
      "/reviews/:kind/:startDate/reviewed",
      zValidator("param", reviewParamSchema),
      async (c) => reviews.reviewed(c, c.req.valid("param")),
    )
    .delete(
      "/activities/:activityId",
      zValidator("param", activityIdParamSchema),
      async (c) => feed.remove(c, c.req.valid("param").activityId),
    )
    .get("/activities/manual", async (c) => manual.list(c))
    .post(
      "/activities/manual",
      zValidator("json", manualActivityRequestSchema),
      async (c) => manual.save(c, "create", undefined, c.req.valid("json")),
    )
    .put(
      "/activities/manual/:id",
      zValidator("param", idParamSchema),
      zValidator("json", manualActivityRequestSchema),
      async (c) => {
        const { id } = c.req.valid("param");
        return manual.save(c, "edit", id, c.req.valid("json"));
      },
    )
    .delete(
      "/activities/manual/:id",
      zValidator("param", idParamSchema),
      async (c) => manual.remove(c, c.req.valid("param").id),
    )
    .post(
      "/questions",
      zValidator("json", quickQuestionRequestSchema),
      async (c) => questions.ask(c, c.req.valid("json")),
    )
    .get("/weekly/notes", async (c) => notes.show(c))
    .post(
      "/weekly/notes",
      zValidator("json", weeklyNoteRequestSchema),
      async (c) => notes.save(c, c.req.valid("json")),
    );
}
