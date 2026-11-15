import {
  DEFAULT_FITNESS_RANGE,
  fitnessHistoryResponseSchema,
  fitnessRangeSchema,
} from "@killingit/shared";
import { Hono } from "hono";
import { getUser } from "../auth/middleware.js";
import { serviceUnavailable } from "../http/errors.js";
import { todayQuerySchema, timezoneSchema } from "../http/query.js";
import { zValidator } from "../http/validation.js";
import { loadStoredActivityFeed } from "../coaching/activityStore.js";
import type { ResolvedAppDependencies } from "../dependencies.js";
import { loadValidatedPlan } from "../plans/store.js";
import { loadFitnessHistory } from "../training/history.js";

/** The fitness window: today, the range, and the athlete's zone. */
const fitnessHistoryQuerySchema = todayQuerySchema.extend({
  range: fitnessRangeSchema.default(DEFAULT_FITNESS_RANGE),
  timezone: timezoneSchema,
});

/**
 * The fitness history behind the Fitness page: the day-by-day training load
 * and estimated FTP for a window ending today.
 */
export function createFitnessRoute(deps: ResolvedAppDependencies): Hono {
  const loadFeed = deps.loadStoredFeed ?? loadStoredActivityFeed;
  const loadHistory = deps.loadFitnessHistory ?? loadFitnessHistory;

  return new Hono().get(
    "/",
    zValidator("query", fitnessHistoryQuerySchema),
    async (c) => {
      const { today, range, timezone } = c.req.valid("query");

      try {
        const user = getUser(c);
        const [feed, stored] = await Promise.all([
          loadFeed(user.id),
          loadValidatedPlan(deps.planStore, user.id),
        ]);
        const history = await loadHistory(
          user.id,
          feed.activities,
          stored?.plan,
          today,
          range,
          user.dietAdvice,
          timezone ?? user.timezone,
        );
        return c.json(fitnessHistoryResponseSchema.parse(history));
      } catch (err) {
        console.error("[fitness] history failure:", err);
        return serviceUnavailable(c);
      }
    },
  );
}
