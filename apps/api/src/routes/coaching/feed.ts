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
  withFeedback,
  type ActivityFeed,
} from "../../coaching/feed/presenter.js";
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
          deps.loadCachedFeed(user.id),
          deps.plans.load(user.id),
        ]);
        if (feed === null) {
          return c.json(
            analyzedActivitiesResponseSchema.parse({
              model: null,
              activities: [],
            }),
          );
        }
        let activities = feed.activities;
        // The cached feed is written by a full sync, so it can lag behind a
        // reply the coach stored during the reply phase. Overlay the current
        // feedback so a reply appears as soon as it is stored.
        try {
          const feedback = await deps.loadFeedback(
            user.id,
            feed.activities.map((activity) => activity.id),
          );
          activities = feed.activities.map((activity) =>
            withFeedback(activity, feedback),
          );
        } catch (err) {
          console.error("[coaching] cached activity feedback failed:", err);
        }
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
        return respondUpstreamError(c, err, {
          log: (failure) =>
            console.error("[coaching] activity feed failure:", failure),
        });
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
