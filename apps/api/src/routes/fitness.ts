import {
  DEFAULT_FITNESS_RANGE,
  fitnessHistoryResponseSchema,
  fitnessRangeSchema,
  planDateSchema,
} from "@killingit/shared";
import { Hono } from "hono";
import { getUser } from "../auth/middleware.js";
import { loadCachedActivityFeed } from "../coaching/feedCache.js";
import type { ResolvedAppDependencies } from "../dependencies.js";
import { loadValidatedPlan } from "../plans/store.js";
import { loadFitnessHistory } from "../training/history.js";

/**
 * The fitness history behind the Fitness page: the day-by-day training load
 * and estimated FTP for a window ending today.
 */
export function createFitnessRoute(deps: ResolvedAppDependencies): Hono {
  const loadFeed = deps.loadCachedFeed ?? loadCachedActivityFeed;
  const loadHistory = deps.loadFitnessHistory ?? loadFitnessHistory;

  return new Hono().get("/", async (c) => {
    const today = planDateSchema.safeParse(c.req.query("today"));
    if (!today.success) {
      return c.text("A valid today date (YYYY-MM-DD) is required", 400);
    }
    const range = fitnessRangeSchema.safeParse(
      c.req.query("range") ?? DEFAULT_FITNESS_RANGE,
    );
    if (!range.success) {
      return c.text(
        "A valid range (week, month, quarter, year, all) is required",
        400,
      );
    }

    try {
      const user = getUser(c);
      const [feed, stored] = await Promise.all([
        loadFeed(user.id),
        loadValidatedPlan(deps.planStore, user.id),
      ]);
      const history = await loadHistory(
        user.id,
        feed?.activities ?? [],
        stored?.plan,
        today.data,
        range.data,
        user.dietAdvice,
      );
      return c.json(fitnessHistoryResponseSchema.parse(history));
    } catch (err) {
      console.error("[fitness] history failure:", err);
      return c.text("Service Unavailable", 503);
    }
  });
}
