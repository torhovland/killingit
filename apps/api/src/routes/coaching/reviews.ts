import {
  coachingInputSaveResponseSchema,
  periodReviewCommentRequestSchema,
  periodReviewsResponseSchema,
  planDateSchema,
  reviewKindSchema,
  type PeriodReview,
  type ReviewKind,
} from "@killingit/shared";
import { z } from "zod";
import type { Context } from "hono";
import { getUser } from "../../auth/middleware.js";
import { toPeriodReview } from "../../plans/periodReviews.js";
import { replyTo, type ResolvedCoachingDependencies } from "./dependencies.js";

type ReviewCommentInput = z.infer<typeof periodReviewCommentRequestSchema>;

/** A parsed review URL, or `null` when the kind or date is invalid. */
function parseReview(
  kind: string,
  startDate: string,
): {
  kind: ReviewKind;
  startDate: string;
} | null {
  const parsedKind = reviewKindSchema.safeParse(kind);
  const parsedDate = planDateSchema.safeParse(startDate);
  if (!parsedKind.success || !parsedDate.success) {
    return null;
  }
  return { kind: parsedKind.data, startDate: parsedDate.data };
}

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
    kindParam: string,
    startDateParam: string,
    input: ReviewCommentInput,
  ) {
    const review = parseReview(kindParam, startDateParam);
    if (review === null) {
      return c.text("Invalid review", 400);
    }

    const user = getUser(c);
    const stored = await deps.loadReview(
      user.id,
      review.kind,
      review.startDate,
    );
    if (stored === null) {
      return c.text("Review not found", 404);
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
      return c.text(
        mode === "create"
          ? "This review already has a comment; edit it instead"
          : "This review has no comment to edit",
        mode === "create" ? 409 : 404,
      );
    }

    const coachReply = await replyTo(deps, user.id, input.today, {
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
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    });

    return c.json(
      coachingInputSaveResponseSchema.parse({
        message: mode === "create" ? "Review comment saved" : "Review updated",
        reply: coachReply,
      }),
    );
  }

  async function reviewed(
    c: Context,
    kindParam: string,
    startDateParam: string,
  ) {
    const review = parseReview(kindParam, startDateParam);
    if (review === null) {
      return c.text("Invalid review", 400);
    }

    const user = getUser(c);
    const updated = await deps.markReviewReviewed(
      user.id,
      review.kind,
      review.startDate,
    );
    if (!updated) {
      return c.text("Review not found", 404);
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
