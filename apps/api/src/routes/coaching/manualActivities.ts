import {
  coachingInputSaveResponseSchema,
  manualActivitiesResponseSchema,
  zonedDateTime,
  type ManualActivityRequest,
} from "@killingit/shared";
import type { Context } from "hono";
import { getUser } from "../../auth/middleware.js";
import { notFound } from "../../http/errors.js";
import type { TodayWithTimezoneQuery } from "../../http/query.js";
import {
  EMPTY_ACTIVITY_LOADS,
  type ActivityLoads,
} from "../../training/activityLoad.js";
import { toCoachAnalysis } from "../../plans/replies.js";
import { ftpBaselineAt, ftpTimeline } from "../../training/thresholds.js";
import type { StoredUser } from "../../users/store.js";
import { replyTo, type ResolvedCoachingDependencies } from "./dependencies.js";

/** Athlete-logged activities, with their coach replies and training load. */
export function createManualActivityHandlers(
  deps: ResolvedCoachingDependencies,
) {
  /**
   * Estimates TSS for a manual entry from its free text. The coach reads the
   * wording; the FTP is the stored value in effect on that date, which the
   * coach itself read from the athlete's input. Without a model there is no
   * estimate, and the entry stays unscored rather than being guessed from
   * keywords.
   */
  async function estimateManualTss(
    userId: number,
    startDate: string,
    details: string,
  ): Promise<number | null> {
    try {
      const llm = await deps.llmLoader(userId);
      if (llm === null) {
        return null;
      }
      const history = await deps.loadThresholds(userId, startDate);
      return await deps.estimateTss(
        llm.provider,
        { apiKey: llm.apiKey, model: llm.dailyModel },
        {
          startDate,
          details,
          ftpWatts:
            ftpBaselineAt(ftpTimeline(history.timelines), startDate) ?? null,
          thresholds: history.summaries,
          userId,
        },
      );
    } catch (err) {
      console.error("[manual-tss] could not estimate the entry:", err);
      return null;
    }
  }

  /**
   * Replies to the saved entry, starts the run its reply asks for, and returns
   * the save response. Creating and updating share this tail, so the reply
   * contract cannot drift between them.
   */
  async function replyAfterSave(
    c: Context,
    user: StoredUser,
    input: ManualActivityRequest,
    activityId: number,
    message: string,
  ) {
    const { today, startDate, details } = input;
    // The request's zone (the device zone when the athlete has not stored one)
    // wins; the stored setting is the fallback for another client.
    const timeZone = input.timezone ?? user.timezone ?? undefined;

    const coachReply = await replyTo(deps, user.id, today, timeZone, {
      kind: "manual_activity",
      manualActivityId: activityId,
      startDate,
      details,
    });

    // The run reads the entry and settles today's plan; the reply's flag
    // decides whether it also pays for a plan completion.
    await deps.trigger(deps.triggerDeps, {
      userId: user.id,
      today,
      timezone: timeZone,
      keepToday: startDate === today,
    });

    return c.json(
      coachingInputSaveResponseSchema.parse({ message, reply: coachReply }),
    );
  }

  async function remove(c: Context, id: number, query: TodayWithTimezoneQuery) {
    const user = getUser(c);
    const { today, timezone } = query;

    const deleted = await deps.deleteManual(user.id, id);
    if (!deleted) {
      return notFound(c, "Manual activity not found");
    }

    await deps.trigger(deps.triggerDeps, {
      userId: user.id,
      today,
      timezone,
    });

    return c.json(
      coachingInputSaveResponseSchema.parse({
        message: "Manual activity deleted",
      }),
    );
  }

  return {
    async list(c: Context) {
      const user = getUser(c);
      const [activities, replies, cached, storedPlan] = await Promise.all([
        deps.loadManual(user.id),
        deps.loadManualReplies(user.id),
        deps.loadStoredFeed(user.id),
        deps.plans.load(user.id),
      ]);
      let loads: ActivityLoads = EMPTY_ACTIVITY_LOADS;
      try {
        loads = await deps.loadActivityTrainingLoads(
          user.id,
          cached.activities,
          storedPlan?.plan,
          zonedDateTime(new Date(), user.timezone).date,
          user.timezone,
        );
      } catch (err) {
        console.error(
          "[training-load] could not score manual activities:",
          err,
        );
      }
      return c.json(
        manualActivitiesResponseSchema.parse({
          manualActivities: activities.map((activity) => {
            const stored = replies.get(activity.id);
            return {
              ...activity,
              coachReply: stored ? toCoachAnalysis(stored) : null,
              trainingLoad: loads.byDate.get(activity.startDate) ?? null,
            };
          }),
        }),
      );
    },
    /** Saves the athlete's new entry and asks the coach about it. */
    async create(c: Context, input: ManualActivityRequest) {
      const user = getUser(c);
      const { startDate, details } = input;
      const estimatedTss = await estimateManualTss(user.id, startDate, details);
      const activityId = await deps.saveManual(user.id, {
        startDate,
        details,
        estimatedTss,
      });
      return replyAfterSave(
        c,
        user,
        input,
        activityId,
        "Manual activity saved",
      );
    },
    /**
     * Updates an existing entry and asks the coach about it. The update doubles
     * as the existence check, so a missing or foreign id is refused before the
     * coach is billed for an estimate. The entry is left unscored until the new
     * estimate is stored, rather than keeping an estimate that describes the
     * text it just replaced.
     */
    async update(c: Context, id: number, input: ManualActivityRequest) {
      const user = getUser(c);
      const { startDate, details } = input;
      const updated = await deps.updateManual(user.id, id, {
        startDate,
        details,
        estimatedTss: null,
      });
      if (!updated) {
        return notFound(c, "Manual activity not found");
      }
      const estimatedTss = await estimateManualTss(user.id, startDate, details);
      if (estimatedTss !== null) {
        await deps.updateManualTss(user.id, id, estimatedTss);
      }
      return replyAfterSave(c, user, input, id, "Manual activity updated");
    },
    remove,
  };
}
