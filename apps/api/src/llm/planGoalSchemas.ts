import type { z } from "zod";
import type { BlockPlan, SeasonPlan } from "@killingit/shared";
import { blockGoalProblems, seasonGoalProblems } from "../plans/goals.js";
import type { PlanContextInput } from "./planContext.js";

/** Adds a plan-level problem to a Zod refinement. */
function addProblems(ctx: z.RefinementCtx, problems: readonly string[]): void {
  for (const message of problems) {
    ctx.addIssue({ code: "custom", message });
  }
}

/**
 * Requires a generated season to carry its goal ledger and every current or
 * future block's sub-goals. The repair turn reads the same messages.
 */
export function withSeasonGoalCoverage<T extends { season: SeasonPlan }>(
  schema: z.ZodType<T>,
  context: PlanContextInput,
): z.ZodType<T> {
  return schema.superRefine((value, ctx) => {
    if (value.season.startDate !== context.today) {
      ctx.addIssue({
        code: "custom",
        message: `The season must start on today's date (${context.today}).`,
        path: ["season", "startDate"],
      });
    }
    addProblems(
      ctx,
      seasonGoalProblems(value.season, {
        today: context.today,
        events: context.events,
      }),
    );
  });
}

/** Requires a generated block to carry the sub-goals of its season summary. */
export function withBlockGoalCoverage<T extends { block: BlockPlan }>(
  schema: z.ZodType<T>,
  context: PlanContextInput & { season: SeasonPlan },
): z.ZodType<T> {
  if (context.season.goals === undefined) {
    // A plan saved before the ledger existed has nothing to check against.
    return schema;
  }
  return schema.superRefine((value, ctx) => {
    addProblems(
      ctx,
      blockGoalProblems(value.block, context.season, {
        today: context.today,
        events: context.events,
      }),
    );
  });
}

/**
 * Checks only the levels a plan-update response carries. An omitted level keeps
 * its stored content and must not be failed for a ledger it cannot change.
 */
export function withPlanGoalCoverage<
  T extends {
    season?: SeasonPlan | undefined;
    block?: BlockPlan | undefined;
    nextBlock?: BlockPlan | null | undefined;
  },
>(
  schema: z.ZodType<T>,
  context: PlanContextInput & {
    season: SeasonPlan;
    block: BlockPlan;
  },
): z.ZodType<T> {
  return schema.superRefine((value, ctx) => {
    if (value.season !== undefined) {
      addProblems(
        ctx,
        seasonGoalProblems(value.season, {
          today: context.today,
          events: context.events,
        }),
      );
    }
    const season = value.season ?? context.season;
    if (season.goals === undefined) {
      return;
    }
    if (value.block !== undefined) {
      addProblems(
        ctx,
        blockGoalProblems(value.block, season, {
          today: context.today,
          events: context.events,
        }),
      );
    }
    if (value.nextBlock !== undefined && value.nextBlock !== null) {
      addProblems(
        ctx,
        blockGoalProblems(value.nextBlock, season, {
          today: context.today,
          events: context.events,
        }),
      );
    }
  });
}
