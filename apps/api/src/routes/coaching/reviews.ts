import {
  coachingInputSaveResponseSchema,
  periodReviewCommentRequestSchema,
  periodReviewsResponseSchema,
  type PeriodReview,
} from "@killingit/shared";
import { z } from "zod";
import type { Context } from "hono";
import { getUser } from "../../auth/middleware.js";
import { conflict, notFound } from "../../http/errors.js";
import { toPeriodReview } from "../../plans/periodReviews.js";
import { replyTo, type ResolvedCoachingDependencies } from "./dependencies.js";
import { reviewParamSchema } from "./schemas.js";

type ReviewCommentInput = z.infer<typeof periodReviewCommentRequestSchema>;

/** The completed week or block a review route addresses. */
type ReviewRef = z.infer<typeof reviewParamSchema>;

/** Completed week and block reviews, with the athlete's comments. */
export function createReviewHandlers(deps: ResolvedCoachingDependencies) {
  /**
   * Saves a comment on a completed week or block, generates the coach's reply
   * to it, and starts a plan revision. `create` refuses to replace an existing
   * comment; `edit` requires one to exist.
   */
  async function save(
    c: Context,
    mode: "create" | "edit",
    review: ReviewRef,
    input: ReviewCommentInput,
  ) {
    const user = getUser(c);
    const stored = await deps.loadReview(
      user.id,
      review.kind,
      review.startDate,
    );
    if (stored === null) {
      return notFound(c, "Review not found");
    }

    const saved =
      mode === "create"
        ? await deps.createReviewComment(
            user.id,
            review.kind,
            review.startDate,
            input.comment,
          )
        : await deps.updateReviewComment(
            user.id,
            review.kind,
            review.startDate,
            input.comment,
          );
    if (!saved) {
      return mode === "create"
        ? conflict(c, "This review already has a comment; edit it instead")
        : notFound(c, "This review has no comment to edit");
    }

    // The request's zone wins; the stored setting is the fallback.
    const timeZone = input.timezone ?? user.timezone ?? undefined;
    const coachReply = await replyTo(deps, user.id, input.today, timeZone, {
      kind: review.kind === "week" ? "week_review" : "block_review",
      startDate: stored.startDate,
      endDate: stored.endDate,
      summary: stored.summary,
      comment: input.comment,
    });

    // The run reads the comment and settles the plan's inputs; the reply's flag
    // decides whether it also pays for a plan completion.
    await deps.trigger(deps.triggerDeps, {
      userId: user.id,
      today: input.today,
      ...(timeZone !== undefined ? { timezone: timeZone } : {}),
    });

    return c.json(
      coachingInputSaveResponseSchema.parse({
        message: mode === "create" ? "Review comment saved" : "Review updated",
        reply: coachReply,
      }),
    );
  }

  async function reviewed(c: Context, review: ReviewRef) {
    const user = getUser(c);
    const updated = await deps.markReviewReviewed(
      user.id,
      review.kind,
      review.startDate,
    );
    if (!updated) {
      return notFound(c, "Review not found");
    }
    return c.json(
      coachingInputSaveResponseSchema.parse({
        message: "Review acknowledged",
      }),
    );
  }

  return {
    async list(c: Context) {
      const user = getUser(c);
      const entries = await deps.loadReviews(user.id);
      const reviews: PeriodReview[] = entries
        .map(toPeriodReview)
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
      return c.json(periodReviewsResponseSchema.parse({ reviews }));
    },
    save,
    reviewed,
  };
}
