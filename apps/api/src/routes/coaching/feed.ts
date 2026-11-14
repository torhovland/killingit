import {
  analyzedActivitiesResponseSchema,
  coachingInputSaveResponseSchema,
  planDateSchema,
} from "@killingit/shared";
import type { Context } from "hono";
import { z } from "zod";
import { getUser } from "../../auth/middleware.js";
import {
  respondUpstreamError,
  serviceUnavailable,
  validationFailed,
} from "../../http/errors.js";
import {
  withActivityLoad,
  type ActivityFeed,
} from "../../coaching/activities.js";
import { latestActivityAnalysisTimestamp } from "../../plans/status.js";
import type { ResolvedCoachingDependencies } from "./dependencies.js";
import { deletionQuerySchema } from "./schemas.js";

const timezoneSchema = z.string().min(1).max(100).optional();

const activityFeedQuerySchema = z.object({
  refresh: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Supplied by the dashboard so a new analysis can refresh the plan. */
  today: planDateSchema.optional(),
  timezone: timezoneSchema,
});

/** The cached feed is read by day, so it needs the athlete's zone too. */
const cachedActivityFeedQuerySchema = z.object({
  timezone: timezoneSchema,
});

/** The stored feed plus coach feedback and training load, without a sync. */
export function createFeedHandlers(deps: ResolvedCoachingDependencies) {
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
      await deps.trigger(
        { ...deps.triggerDeps, loadActivities: () => Promise.resolve(feed) },
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

  return {
    async cached(c: Context) {
      const query = cachedActivityFeedQuerySchema.safeParse(c.req.query());
      if (!query.success) {
        return validationFailed(c, query.error, "Invalid query parameters");
      }

      try {
        const user = getUser(c);
        const timeZone = query.data.timezone ?? user.timezone;
        const [feed, storedPlan] = await Promise.all([
          deps.loadStoredFeed(user.id, "samples"),
          deps.plans.load(user.id),
        ]);
        if (feed.activities.length === 0) {
          return c.json(
            analyzedActivitiesResponseSchema.parse({
              model: null,
              activities: [],
            }),
          );
        }
        // The stored feed joins the latest comment, reply and analysis, so it
        // never lags behind a coach reply; only the training load is computed.
        let activities = feed.activities;
        try {
          const loads = await deps.loadActivityTrainingLoads(
            user.id,
            activities,
            storedPlan?.plan,
            timeZone,
          );
          activities = activities.map((activity) =>
            withActivityLoad(activity, loads, timeZone),
          );
        } catch (err) {
          console.error("[training-load] cached activity scoring failed:", err);
        }
        return c.json(
          analyzedActivitiesResponseSchema.parse({ ...feed, activities }),
        );
      } catch (err) {
        console.error("[coaching] cached activity feed failure:", err);
        return serviceUnavailable(c);
      }
    },

    async activities(c: Context) {
      const query = activityFeedQuerySchema.safeParse(c.req.query());
      if (!query.success) {
        return validationFailed(c, query.error, "Invalid query parameters");
      }

      try {
        const user = getUser(c);
        // The request's zone (the device zone when the athlete has not stored
        // one) wins; the account's stored setting is the fallback.
        const timeZone = query.data.timezone ?? user.timezone ?? undefined;
        const feed = await deps.loadActivities(
          user.id,
          query.data.today,
          timeZone,
        );
        await refreshPlanAfterAnalysis(
          user.id,
          feed,
          query.data.today,
          timeZone,
        );
        return c.json(analyzedActivitiesResponseSchema.parse(feed));
      } catch (err) {
        // A Garmin, sidecar or OpenRouter failure carries the status the
        // athlete needs: an account to connect, a credential to replace, or a
        // provider that is down.
        return respondUpstreamError(c, err, "[coaching] activity feed failure");
      }
    },

    async remove(c: Context, activityId: string) {
      const query = deletionQuerySchema.safeParse(c.req.query());
      if (!query.success) {
        return validationFailed(
          c,
          query.error,
          "A valid today date (YYYY-MM-DD) is required",
        );
      }

      const user = getUser(c);
      const { today, timezone } = query.data;

      await deps.deleteImported(user.id, activityId);
      await deps.trigger(deps.triggerDeps, {
        userId: user.id,
        today,
        ...(timezone !== undefined ? { timezone } : {}),
      });

      return c.json(
        coachingInputSaveResponseSchema.parse({
          message: "Activity deleted",
        }),
      );
    },
  };
}
