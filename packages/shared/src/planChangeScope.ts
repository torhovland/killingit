import { z } from "zod";

/**
 * The highest training level an athlete input changes, as judged by the coach
 * completion that already read the input. Ordered from no change to a whole
 * season refresh: a later value includes the earlier ones, so `block` also
 * covers the block's week and day.
 *
 * See `docs/specs/plan-refresh-judgement.md`.
 */
export const PLAN_CHANGE_SCOPES = [
  "none",
  "day",
  "week",
  "block",
  "season",
] as const;

export const planChangeScopeSchema = z.enum(PLAN_CHANGE_SCOPES);

export type PlanChangeScope = z.infer<typeof planChangeScopeSchema>;

const SCOPE_RANK: Record<PlanChangeScope, number> = {
  none: 0,
  day: 1,
  week: 2,
  block: 3,
  season: 4,
};

/**
 * True when `scope` reaches at least `level`. Used to tell a review that only
 * reaches the week from one that must revise the block.
 */
export function planChangeScopeIncludes(
  scope: PlanChangeScope,
  level: PlanChangeScope,
): boolean {
  return SCOPE_RANK[scope] >= SCOPE_RANK[level];
}

/**
 * The widest scope in a set, so a day-scoped input cannot hide a season-scoped
 * one in the same refresh window. An empty set is `none`.
 */
export function widestPlanChangeScope(
  scopes: readonly PlanChangeScope[],
): PlanChangeScope {
  return scopes.reduce<PlanChangeScope>(
    (widest, scope) =>
      SCOPE_RANK[scope] > SCOPE_RANK[widest] ? scope : widest,
    "none",
  );
}
