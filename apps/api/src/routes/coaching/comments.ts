import {
  coachingInputSaveResponseSchema,
  type ActivityCommentRequest,
} from "@killingit/shared";
import type { Context } from "hono";
import { getAthlete } from "../../auth/middleware.js";
import type { ResolvedCoachingDependencies } from "./dependencies.js";

/** The athlete's comment on one recorded activity. */
export function createCommentHandlers(deps: ResolvedCoachingDependencies) {
  /**
   * Saves the activity's single comment, regenerates its coach reply, and
   * starts a plan revision. `create` refuses to replace an existing comment;
   * `edit` requires one to exist.
   */
  async function save(
    c: Context,
    mode: "create" | "edit",
    activityId: string,
    input: ActivityCommentRequest,
  ) {
    const user = await deps.users.ensureUser(getAthlete(c).sub);
    const { today, timezone, activityDate, comment } = input;

    const saved =
      mode === "create"
        ? await deps.createComment(user.id, { activityId, comment })
        : await deps.updateComment(user.id, { activityId, comment });
    if (!saved) {
      return c.text(
        mode === "create"
          ? "This activity already has a comment; edit it instead"
          : "This activity has no comment to edit",
        mode === "create" ? 409 : 404,
      );
    }

    // The run answers every unanswered comment and then refreshes the plan.
    // Replies are stored before the plan phase, so the dashboard's reply poll
    // shows them while the coach is still thinking about the plan.
    await deps.startRun(deps.coachRunDeps, {
      userId: user.id,
      today,
      ...(timezone !== undefined ? { timezone } : {}),
      keepToday: activityDate === today,
      reply: true,
    });

    return c.json(
      coachingInputSaveResponseSchema.parse({
        message: mode === "create" ? "Comment saved" : "Comment updated",
        reply: null,
      }),
    );
  }

  async function reviewed(c: Context, activityId: string) {
    const user = await deps.users.ensureUser(getAthlete(c).sub);
    await deps.saveReview(user.id, activityId);
    return c.json(
      coachingInputSaveResponseSchema.parse({
        message: "Activity acknowledged",
      }),
    );
  }

  return { save, reviewed };
}
