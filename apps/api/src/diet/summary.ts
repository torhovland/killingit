import type { FoodAnalysis } from "@killingit/shared";
import { addDays, startOfWeek } from "../plans/dates.js";

/** The window of individually listed meals shown to the coach. */
export const DIET_RECENT_DAYS = 7;

/** How far back the weekly nutrition summaries go. */
export const DIET_SUMMARY_DAYS = 365;

/** The most weekly summaries a prompt ever carries. */
export const MAX_DIET_WEEK_SUMMARIES = 52;

/** One meal as the prompt context needs it. */
export interface DietMealContext {
  eatenDate: string;
  eatenTime: string;
  /** Null when the athlete logged the meal by photo alone. */
  description: string | null;
  analysis: FoodAnalysis | null;
  analysisError: string | null;
}

/** The aggregate nutrition of one completed week. */
export interface DietWeekSummary {
  weekStart: string;
  meals: number;
  daysLogged: number;
  /** Days with at least one analysed meal; the averages use this count. */
  nutritionDays: number;
  carbsGramsPerDay: number | null;
  proteinGramsPerDay: number | null;
  fatGramsPerDay: number | null;
  caloriesKcalPerDay: number | null;
}

/** The food log given to every coach prompt. */
export interface DietPromptContext {
  meals: readonly DietMealContext[];
  weeks: readonly DietWeekSummary[];
}

/** One stored meal, structurally compatible with `StoredFoodEntry`. */
export interface DietSourceEntry {
  eatenDate: string;
  eatenTime: string;
  description: string | null;
  analysis: FoodAnalysis | null;
  analysisError: string | null;
}

/**
 * Splits a year of meals into the individually listed last seven days and the
 * aggregate of each completed week. Pure so the window and rounding rules are
 * tested without a database.
 */
export function summarizeDiet(
  entries: readonly DietSourceEntry[],
  today: string,
): DietPromptContext {
  const recentFrom = addDays(today, -(DIET_RECENT_DAYS - 1));
  const summaryFrom = addDays(today, -DIET_SUMMARY_DAYS);

  const meals = entries
    .filter(
      (entry) => entry.eatenDate >= recentFrom && entry.eatenDate <= today,
    )
    .map(toMealContext)
    .sort((a, b) =>
      `${b.eatenDate} ${b.eatenTime}`.localeCompare(
        `${a.eatenDate} ${a.eatenTime}`,
      ),
    );

  const weeks = new Map<string, DietSourceEntry[]>();
  for (const entry of entries) {
    if (entry.eatenDate < summaryFrom || entry.eatenDate >= today) {
      continue;
    }
    const weekStart = startOfWeek(entry.eatenDate);
    // Only completed weeks are summarised. The current week's meals are in the
    // recent list and become a summary once the week has ended. A week that
    // starts before the one-year window is dropped rather than averaged from
    // only the days inside it.
    if (weekStart < summaryFrom || addDays(weekStart, 6) >= today) {
      continue;
    }
    const group = weeks.get(weekStart);
    if (group === undefined) {
      weeks.set(weekStart, [entry]);
    } else {
      group.push(entry);
    }
  }

  const summaries = [...weeks.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, MAX_DIET_WEEK_SUMMARIES)
    .map(([weekStart, group]) => summarizeWeek(weekStart, group));

  return { meals, weeks: summaries };
}

function toMealContext(entry: DietSourceEntry): DietMealContext {
  return {
    eatenDate: entry.eatenDate,
    eatenTime: entry.eatenTime,
    description: entry.description,
    analysis: entry.analysis,
    analysisError: entry.analysisError,
  };
}

function summarizeWeek(
  weekStart: string,
  entries: readonly DietSourceEntry[],
): DietWeekSummary {
  const loggedDates = new Set<string>();
  const nutritionDates = new Set<string>();
  let carbs = 0;
  let protein = 0;
  let fat = 0;
  let calories = 0;

  for (const entry of entries) {
    loggedDates.add(entry.eatenDate);
    if (entry.analysis === null) {
      continue;
    }
    nutritionDates.add(entry.eatenDate);
    carbs += entry.analysis.carbsGrams;
    protein += entry.analysis.proteinGrams;
    fat += entry.analysis.fatGrams;
    calories += entry.analysis.caloriesKcal;
  }

  const days = nutritionDates.size;
  return {
    weekStart,
    meals: entries.length,
    daysLogged: loggedDates.size,
    nutritionDays: days,
    carbsGramsPerDay: days === 0 ? null : Math.round(carbs / days),
    proteinGramsPerDay: days === 0 ? null : Math.round(protein / days),
    fatGramsPerDay: days === 0 ? null : Math.round(fat / days),
    caloriesKcalPerDay: days === 0 ? null : Math.round(calories / days),
  };
}
