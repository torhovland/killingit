import {
  coachPlanSchema,
  fitnessHistoryResponseSchema,
  planDateSchema,
  type AnalyzedActivitiesResponse,
} from "@killingit/shared";
import { Hono } from "hono";
import { getAthlete } from "../auth/middleware.js";
import { loadCachedActivityFeed } from "../coaching/feedCache.js";
import type { PlanStore } from "../plans/store.js";
import {
  DEFAULT_FITNESS_DAYS,
  loadFitnessHistory,
} from "../training/history.js";
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
    // An unparseable length falls back to the default inside the loader.
    const days = Number(c.req.query("days") ?? DEFAULT_FITNESS_DAYS);

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
        days,
      );
      return c.json(fitnessHistoryResponseSchema.parse(history));
    } catch (err) {
      console.error("[fitness] history failure:", err);
      return c.text("Service Unavailable", 503);
    }
  });
}
