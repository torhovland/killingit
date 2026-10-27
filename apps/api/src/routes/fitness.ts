import {
  coachPlanSchema,
  DEFAULT_FITNESS_RANGE,
  fitnessHistoryResponseSchema,
  fitnessRangeSchema,
  planDateSchema,
  type AnalyzedActivitiesResponse,
} from "@killingit/shared";
import { Hono } from "hono";
import { getAthlete } from "../auth/middleware.js";
import { loadCachedActivityFeed } from "../coaching/feedCache.js";
import type { PlanStore } from "../plans/store.js";
import { loadFitnessHistory } from "../training/history.js";
import type { UserStore } from "../users/store.js";

export interface FitnessRouteDependencies {
  users: UserStore;
  plans: PlanStore;
  /** Injectable for route tests; defaults to the stored activity feed. */
  loadCachedFeed?: (
    userId: number,
  ) => Promise<AnalyzedActivitiesResponse | null>;
  /** Injectable for route tests; defaults to the database-backed loader. */
  loadHistory?: typeof loadFitnessHistory;
}

/**
 * The fitness history behind the Fitness page: the day-by-day training load
 * and estimated FTP for a window ending today.
 */
export function createFitnessRoute(deps: FitnessRouteDependencies): Hono {
  const loadFeed = deps.loadCachedFeed ?? loadCachedActivityFeed;
  const loadHistory = deps.loadHistory ?? loadFitnessHistory;

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
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const [feed, stored] = await Promise.all([
        loadFeed(user.id),
        deps.plans.load(user.id),
      ]);
      const parsedPlan =
        stored === null ? null : coachPlanSchema.safeParse(stored.plan);
      const history = await loadHistory(
        user.id,
        feed?.activities ?? [],
        parsedPlan?.success ? parsedPlan.data : undefined,
        today.data,
        range.data,
      );
      return c.json(fitnessHistoryResponseSchema.parse(history));
    } catch (err) {
      console.error("[fitness] history failure:", err);
      return c.text("Service Unavailable", 503);
    }
  });
}
