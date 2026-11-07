import type {
  BlockPlan,
  CoachPlan,
  DietProgress,
  FitnessDietTarget,
  WeekPlan,
} from "@killingit/shared";
import { addDays } from "../plans/dates.js";

/**
 * Flattens the coach's diet progress targets to one point per period end, from
 * `today` onward, ascending. The season plan supplies the block and season
 * targets; the detailed block and week plans are newer and win when a date
 * appears twice, with the weekly target the most specific. A null measure keeps
 * an earlier non-null value for the same date, because null means "not
 * estimated" rather than "no target".
 */
export function planDietTargets(
  plan: CoachPlan | undefined,
  today: string,
): FitnessDietTarget[] {
  const targets = new Map<string, FitnessDietTarget>();
  const add = (
    date: string,
    progress: DietProgress | null | undefined,
  ): void => {
    if (progress === null || progress === undefined) {
      return;
    }
    if (
      progress.targetWeightKg === null &&
      progress.targetBodyFatPercent === null
    ) {
      return;
    }
    const existing = targets.get(date);
    targets.set(date, {
      date,
      weightKg: progress.targetWeightKg ?? existing?.weightKg ?? null,
      bodyFatPercent:
        progress.targetBodyFatPercent ?? existing?.bodyFatPercent ?? null,
    });
  };
  if (plan === undefined) {
    return [];
  }

  for (const block of plan.season.blocks) {
    add(block.endDate, block.dietProgress);
  }
  add(plan.season.endDate, plan.season.dietProgress);

  addBlockTargets(add, plan.block);
  if (plan.nextBlock !== null) {
    addBlockTargets(add, plan.nextBlock);
  }

  addWeekTargets(add, plan.week);
  if (plan.nextWeek !== null) {
    addWeekTargets(add, plan.nextWeek);
  }

  return [...targets.values()]
    .filter((target) => target.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
}

type TargetAdder = (
  date: string,
  progress: DietProgress | null | undefined,
) => void;

function addBlockTargets(add: TargetAdder, block: BlockPlan): void {
  add(block.endDate, block.dietProgress);
  for (const week of block.weeks) {
    add(addDays(week.startDate, 6), week.dietProgress);
  }
}

function addWeekTargets(add: TargetAdder, week: WeekPlan): void {
  add(addDays(week.startDate, 6), week.dietProgress);
}
