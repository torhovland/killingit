import {
  coachingInputSaveResponseSchema,
  manualActivitiesResponseSchema,
  type ManualActivityRequest,
} from "@killingit/shared";
import type { Context } from "hono";
import { getAthlete } from "../../auth/middleware.js";
import type { ActivityLoads } from "../../training/activityLoad.js";
import { toCoachAnalysis } from "../../plans/replies.js";
import { ftpBaselineAt, ftpTimeline } from "../../training/thresholds.js";
import { replyTo, type ResolvedCoachingDependencies } from "./dependencies.js";
import { deletionQuerySchema } from "./schemas.js";

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
        { apiKey: llm.apiKey, model: llm.model },
        {
          startDate,
          details,
          ftpWatts:
            ftpBaselineAt(ftpTimeline(history.timelines), startDate)?.watts ??
            null,
          thresholds: history.summaries,
          userId,
        },
      );
    } catch (err) {
      console.error("[manual-tss] could not estimate the entry:", err);
      return null;
    }
  }

  /** Saves a new entry or updates an existing one, then asks the coach about it. */
  async function save(
    c: Context,
    mode: "create" | "edit",
    idParam: string | undefined,
    input: ManualActivityRequest,
  ) {
    const user = await deps.users.ensureUser(getAthlete(c).sub);
    const id = mode === "create" ? undefined : Number(idParam);
    if (mode === "edit" && Number.isNaN(id)) {
      return c.text("Invalid manual activity id", 400);
    }

    const { today, timezone, ...activity } = input;
    const estimatedTss = await estimateManualTss(
      user.id,
      activity.startDate,
      activity.details,
    );

    let activityId: number;
    if (id === undefined) {
      activityId = await deps.saveManual(user.id, {
        ...activity,
        estimatedTss,
      });
    } else {
      const updated = await deps.updateManual(user.id, id, {
        ...activity,
        estimatedTss,
      });
      if (!updated) {
        return c.text("Manual activity not found", 404);
      }
      activityId = id;
    }

    const coachReply = await replyTo(deps, user.id, today, {
      kind: "manual_activity",
      manualActivityId: activityId,
      startDate: activity.startDate,
      details: activity.details,
    });

    await deps.trigger(deps.triggerDeps, {
      userId: user.id,
      today,
      ...(timezone !== undefined ? { timezone } : {}),
      keepToday: activity.startDate === today,
    });

    return c.json(
      coachingInputSaveResponseSchema.parse({
        message:
          mode === "create"
            ? "Manual activity saved"
            : "Manual activity updated",
        reply: coachReply,
      }),
    );
  }

  async function remove(c: Context, idParam: string) {
    const query = deletionQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.text("A valid today date (YYYY-MM-DD) is required", 400);
    }

    const user = await deps.users.ensureUser(getAthlete(c).sub);
    const id = Number(idParam);
    if (Number.isNaN(id)) {
      return c.text("Invalid manual activity id", 400);
    }
    const { today, timezone } = query.data;

    const deleted = await deps.deleteManual(user.id, id);
    if (!deleted) {
      return c.text("Manual activity not found", 404);
    }

    await deps.trigger(deps.triggerDeps, {
      userId: user.id,
      today,
      ...(timezone !== undefined ? { timezone } : {}),
    });

    return c.json(
      coachingInputSaveResponseSchema.parse({
        message: "Manual activity deleted",
      }),
    );
  }

  return {
    async list(c: Context) {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const [activities, replies, cached, storedPlan] = await Promise.all([
        deps.loadManual(user.id),
        deps.loadManualReplies(user.id),
        deps.loadCachedFeed(user.id),
        deps.plans.load(user.id),
      ]);
      let loads: ActivityLoads = {
        byDate: new Map(),
        byActivityId: new Map(),
      };
      try {
        loads = await deps.loadActivityTrainingLoads(
          user.id,
          cached?.activities ?? [],
          storedPlan?.plan,
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
    save,
    remove,
  };
}
