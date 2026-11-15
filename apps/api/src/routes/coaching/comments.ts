import {
  coachingInputSaveResponseSchema,
  type ActivityCommentRequest,
} from "@killingit/shared";
import type { Context } from "hono";
import { getUser } from "../../auth/middleware.js";
import { conflict, notFound } from "../../http/errors.js";
import type { StoredUser } from "../../users/store.js";
import type { ResolvedCoachingDependencies } from "./dependencies.js";

/** The athlete's comment on one recorded activity. */
export function createCommentHandlers(deps: ResolvedCoachingDependencies) {
  /**
   * Starts the reply-and-plan run the saved comment asks for and returns the
   * save response. Adding and editing share this tail, so the reply contract
   * cannot drift between them.
   */
  async function refreshAfterSave(
    c: Context,
    user: StoredUser,
    input: ActivityCommentRequest,
    message: string,
  ) {
    const { today, activityDate } = input;
    // The request's zone (the device zone when the athlete has not stored one)
    // wins; the stored setting is the fallback for another client.
    const timeZone = input.timezone ?? user.timezone ?? undefined;

    // The run answers every unanswered comment and then refreshes the plan.
    // Replies are stored before the plan phase, so the dashboard's reply poll
    // shows them while the coach is still thinking about the plan.
    await deps.startRun(deps.coachRunDeps, {
      userId: user.id,
      today,
      ...(timeZone !== undefined ? { timezone: timeZone } : {}),
      keepToday: activityDate === today,
      reply: true,
    });

    return c.json(
      coachingInputSaveResponseSchema.parse({ message, reply: null }),
    );
  }

  async function reviewed(c: Context, activityId: string) {
    const user = getUser(c);
    await deps.saveReview(user.id, activityId);
    return c.json(
      coachingInputSaveResponseSchema.parse({
        message: "Activity acknowledged",
      }),
    );
  }

  return {
    /** Adds the activity's first comment; a second add is refused. */
    async create(
      c: Context,
      activityId: string,
      input: ActivityCommentRequest,
    ) {
      const user = getUser(c);
      const saved = await deps.createComment(user.id, {
        activityId,
        comment: input.comment,
      });
      if (!saved) {
        return conflict(
          c,
          "This activity already has a comment; edit it instead",
        );
      }
      return refreshAfterSave(c, user, input, "Comment saved");
    },

    /** Replaces an existing comment; an activity without one is not found. */
    async update(
      c: Context,
      activityId: string,
      input: ActivityCommentRequest,
    ) {
      const user = getUser(c);
      const saved = await deps.updateComment(user.id, {
        activityId,
        comment: input.comment,
      });
      if (!saved) {
        return notFound(c, "This activity has no comment to edit");
      }
      return refreshAfterSave(c, user, input, "Comment updated");
    },

    reviewed,
  };
}
