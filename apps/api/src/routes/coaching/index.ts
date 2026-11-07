import {
  activityCommentRequestSchema,
  coachQuestionAnswerRequestSchema,
  manualActivityRequestSchema,
  periodReviewCommentRequestSchema,
  quickQuestionRequestSchema,
  weeklyNoteRequestSchema,
} from "@killingit/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createCoachQuestionHandlers } from "./coachQuestions.js";
import { createCommentHandlers } from "./comments.js";
import {
  resolveCoachingDependencies,
  type CoachingRouteDependencies,
} from "./dependencies.js";
import { createFeedHandlers } from "./feed.js";
import { createManualActivityHandlers } from "./manualActivities.js";
import { createReviewHandlers } from "./reviews.js";
import { createWeeklyNoteHandlers } from "./weeklyNotes.js";

export type { CoachingRouteDependencies } from "./dependencies.js";

/**
 * Coaching routes (ADR 0004). Syncs the signed-in athlete's Garmin activities,
 * analyses the most recent ones with the configured LLM, and returns activity
 * data plus cached-or-fresh coach analysis. Also accepts activity comments and
 * manual activity logs, replies to them briefly, and triggers a plan revision
 * when the plan is already established.
 */
export function createCoachingRoute(deps: CoachingRouteDependencies): Hono {
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
      zValidator("json", activityCommentRequestSchema),
      async (c) =>
        comments.save(
          c,
          "create",
          c.req.param("activityId"),
          c.req.valid("json"),
        ),
    )
    .put(
      "/activities/:activityId/comments",
      zValidator("json", activityCommentRequestSchema),
      async (c) =>
        comments.save(
          c,
          "edit",
          c.req.param("activityId"),
          c.req.valid("json"),
        ),
    )
    .post("/activities/:activityId/reviewed", async (c) =>
      comments.reviewed(c, c.req.param("activityId")),
    )
    .get("/coach-questions", async (c) => questions.list(c))
    .post(
      "/coach-questions/:id/answer",
      zValidator("json", coachQuestionAnswerRequestSchema),
      async (c) => questions.answer(c, c.req.param("id"), c.req.valid("json")),
    )
    .get("/reviews", async (c) => reviews.list(c))
    .post(
      "/reviews/:kind/:startDate/comments",
      zValidator("json", periodReviewCommentRequestSchema),
      async (c) =>
        reviews.save(
          c,
          "create",
          c.req.param("kind"),
          c.req.param("startDate"),
          c.req.valid("json"),
        ),
    )
    .put(
      "/reviews/:kind/:startDate/comments",
      zValidator("json", periodReviewCommentRequestSchema),
      async (c) =>
        reviews.save(
          c,
          "edit",
          c.req.param("kind"),
          c.req.param("startDate"),
          c.req.valid("json"),
        ),
    )
    .post("/reviews/:kind/:startDate/reviewed", async (c) =>
      reviews.reviewed(c, c.req.param("kind"), c.req.param("startDate")),
    )
    .delete("/activities/:activityId", async (c) =>
      feed.remove(c, c.req.param("activityId")),
    )
    .get("/activities/manual", async (c) => manual.list(c))
    .post(
      "/activities/manual",
      zValidator("json", manualActivityRequestSchema),
      async (c) => manual.save(c, "create", undefined, c.req.valid("json")),
    )
    .put(
      "/activities/manual/:id",
      zValidator("json", manualActivityRequestSchema),
      async (c) =>
        manual.save(c, "edit", c.req.param("id"), c.req.valid("json")),
    )
    .delete("/activities/manual/:id", async (c) =>
      manual.remove(c, c.req.param("id")),
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
