import type { DietDaySummary, DietSummaryResponse } from "@killingit/shared";
import { toFoodEntry } from "./presenter.js";
import type { StoredFoodEntry } from "./store.js";

/**
 * Calories from analysed meals, keyed by the athlete's local date. Days with no
 * analysed meal are absent rather than zero, so an unlogged day never reads as
 * a day with no food.
 */
export function consumedCaloriesByDate(
  entries: readonly StoredFoodEntry[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (entry.analysis === null) {
      continue;
    }
    totals.set(
      entry.eatenDate,
      (totals.get(entry.eatenDate) ?? 0) + entry.analysis.caloriesKcal,
    );
  }
  return new Map(
    [...totals].map(([date, calories]) => [date, Math.round(calories)]),
  );
}

/**
 * Groups the food log into days and pairs each day with the coach's calorie
 * requirement. Every day with a meal or a target is returned, newest first, so
 * the Diet page can show logged against needed for each day.
 */
export function buildDietSummary(input: {
  entries: readonly StoredFoodEntry[];
  targets: ReadonlyMap<string, number>;
  goal: string | null;
  assessment: string | null;
  /** Today's local date, so its target shows before the first meal. */
  today: string;
}): DietSummaryResponse {
  const entriesByDate = new Map<string, StoredFoodEntry[]>();
  for (const entry of input.entries) {
    const group = entriesByDate.get(entry.eatenDate);
    if (group === undefined) {
      entriesByDate.set(entry.eatenDate, [entry]);
    } else {
      group.push(entry);
    }
  }

  // Every day with a meal, plus today's plan before anything has been logged.
  // A past target with no meal is not a logged day and would only add noise.
  const dates = new Set(entriesByDate.keys());
  if (input.targets.has(input.today)) {
    dates.add(input.today);
  }
  const days: DietDaySummary[] = [...dates]
    .sort((a, b) => b.localeCompare(a))
    .map((date) => {
      const entries = (entriesByDate.get(date) ?? [])
        .slice()
        .sort((a, b) => b.eatenAt.getTime() - a.eatenAt.getTime());
      const analysed = entries.filter((entry) => entry.analysis !== null);
      const consumedCaloriesKcal =
        analysed.length === 0
          ? null
          : Math.round(
              analysed.reduce(
                (total, entry) => total + (entry.analysis?.caloriesKcal ?? 0),
                0,
              ),
            );
      const neededCaloriesKcal = input.targets.get(date) ?? null;
      return {
        date,
        neededCaloriesKcal,
        consumedCaloriesKcal,
        balanceKcal:
          consumedCaloriesKcal === null || neededCaloriesKcal === null
            ? null
            : consumedCaloriesKcal - neededCaloriesKcal,
        entries: entries.map(toFoodEntry),
      };
    });

  return {
    goal: input.goal,
    assessment: input.assessment,
    days,
  };
}
