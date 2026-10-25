import type { BlockPlan, CoachPlan, WeekPlan } from "@killingit/shared";
import { addDays } from "./dates.js";

/** The last day (Sunday) of a Monday-based week plan. */
export function weekEnd(week: WeekPlan): string {
  return addDays(week.startDate, 6);
}

export function weekCovers(week: WeekPlan, date: string): boolean {
  return date >= week.startDate && date <= weekEnd(week);
}

export function blockCovers(block: BlockPlan, date: string): boolean {
  return date >= block.startDate && date <= block.endDate;
}

/** The stored week that contains `date`, current or next. */
export function weekFor(plan: CoachPlan, date: string): WeekPlan | null {
  if (weekCovers(plan.week, date)) {
    return plan.week;
  }
  if (plan.nextWeek !== null && weekCovers(plan.nextWeek, date)) {
    return plan.nextWeek;
  }
  return null;
}

/** The stored block that contains `date`, current or next. */
export function blockFor(plan: CoachPlan, date: string): BlockPlan | null {
  if (blockCovers(plan.block, date)) {
    return plan.block;
  }
  if (plan.nextBlock !== null && blockCovers(plan.nextBlock, date)) {
    return plan.nextBlock;
  }
  return null;
}

/**
 * Moves a stored next week or block into the current slot once today has
 * reached it. The previous period is dropped here, after its review has been
 * captured by the caller. Tomorrow's day plan becomes today's when it matches,
 * so the session planned last night survives the rollover.
 */
export function promoteNextPeriod(plan: CoachPlan, today: string): CoachPlan {
  let next = plan;
  let weekPromoted = false;

  if (plan.nextWeek !== null) {
    if (weekCovers(plan.nextWeek, today)) {
      next = { ...next, week: plan.nextWeek, nextWeek: null };
      weekPromoted = true;
    } else if (today > weekEnd(plan.nextWeek)) {
      next = { ...next, nextWeek: null };
    }
  }

  if (plan.nextBlock !== null) {
    if (blockCovers(plan.nextBlock, today)) {
      next = { ...next, block: plan.nextBlock, nextBlock: null };
    } else if (today > plan.nextBlock.endDate) {
      next = { ...next, nextBlock: null };
    }
  }

  if (plan.tomorrow !== null) {
    if (plan.tomorrow.date === today && weekPromoted) {
      next = { ...next, today: plan.tomorrow, tomorrow: null };
    } else if (plan.tomorrow.date !== addDays(today, 1)) {
      next = { ...next, tomorrow: null };
    }
  }

  return next;
}
