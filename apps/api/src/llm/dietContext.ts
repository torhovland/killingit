import { isDefaultDietGoal, type DietPlan } from "@killingit/shared";
import type {
  DietMealContext,
  DietPromptContext,
  DietWeekSummary,
} from "../diet/summary.js";
import { impliedGoalBodyFatPercent } from "../plans/dietProgress.js";

/** One earlier calorie requirement the coach set for a day. */
export interface CalorieTargetPoint {
  date: string;
  caloriesKcal: number;
}

/**
 * Renders the coach's diet goal, its status, the target and any stated
 * trade-off, so every prompt judges the athlete's nutrition against the same
 * goal. Always returns the leading blank separator and the goal lines.
 */
export function formatDietGoal(diet: DietPlan): string[] {
  const lines = [
    "",
    `Diet goal: ${diet.goal}`,
    `Diet goal status: ${
      (diet.goalProvided ?? !isDefaultDietGoal(diet.goal))
        ? "stated by the athlete"
        : "default because the athlete stated none"
    }.`,
  ];
  const goalTarget = formatDietGoalTarget(diet);
  if (goalTarget !== null) {
    lines.push(`Diet goal target: ${goalTarget}.`);
  }
  if (diet.goalMissReason != null && diet.goalMissReason.trim() !== "") {
    lines.push(`Diet goal trade-off: ${diet.goalMissReason.trim()}`);
  }
  lines.push(`Diet assessment: ${diet.assessment}`);
  return lines;
}

/** Renders whether the athlete has enabled diet advice. */
export function formatDietAdvice(enabled: boolean): string[] {
  return ["", `Diet advice: ${enabled ? "enabled" : "disabled"}.`];
}

/** Renders the coach's earlier daily calorie targets, newest first. */
export function formatCalorieHistory(
  points: readonly CalorieTargetPoint[],
): string[] {
  if (points.length === 0) {
    return [];
  }
  return [
    "",
    "Earlier daily calorie targets (newest first; your own estimates, shown so you can judge the weight trend):",
    ...points.map(
      (point) => `- ${point.date}: ${Math.round(point.caloriesKcal)} kcal`,
    ),
  ];
}

/**
 * Renders the food log for a prompt: the individually listed meals of the last
 * seven days and the aggregate of each completed week. Empty when the athlete
 * has logged nothing, and omitted entirely when diet advice is off.
 */
export function formatDietContext(
  diet: DietPromptContext,
  today: string,
): string[] {
  if (diet.meals.length === 0 && diet.weeks.length === 0) {
    return [];
  }
  const lines = [
    "",
    `Food log (times are the athlete's local clock; nutrition numbers are your earlier estimates, not measurements):`,
  ];
  if (diet.meals.length === 0) {
    lines.push("No meals were logged in the last 7 days.");
  } else {
    lines.push(
      "Recent meals (last 7 days, most recent first):",
      ...diet.meals.map(formatDietMeal),
    );
  }
  if (diet.weeks.length > 0) {
    lines.push(
      `Weekly nutrition summary for completed weeks (most recent first, up to one year from ${today}):`,
      ...diet.weeks.map(formatDietWeek),
    );
  }
  return lines;
}

/** The numeric goal the athlete stated, in one prompt line. */
function formatDietGoalTarget(diet: DietPlan): string | null {
  const parts: string[] = [];
  if (diet.goalWeightKg != null) {
    parts.push(`${diet.goalWeightKg.toFixed(1)} kg`);
  }
  const goalBodyFatPercent =
    diet.goalBodyFatPercent ?? impliedGoalBodyFatPercent(diet.goal);
  if (goalBodyFatPercent !== null) {
    parts.push(`${goalBodyFatPercent.toFixed(1)} % body fat`);
  }
  if (diet.goalDate != null) {
    parts.push(`by ${diet.goalDate}`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

function formatDietMeal(meal: DietMealContext): string {
  const athlete =
    meal.description === null || meal.description.trim() === ""
      ? "Athlete: (no description; photo only)"
      : `Athlete: "${oneLine(meal.description)}"`;
  if (meal.analysis === null) {
    const why =
      meal.analysisError !== null && meal.analysisError.trim() !== ""
        ? ` (${oneLine(meal.analysisError)})`
        : "";
    return `- ${meal.eatenDate} ${meal.eatenTime} — ${athlete} — Coach analysis unavailable${why}.`;
  }
  const analysis = meal.analysis;
  return `- ${meal.eatenDate} ${meal.eatenTime} — ${athlete} — Coach: ${oneLine(analysis.meal)} — ${Math.round(analysis.carbsGrams)} g carbs, ${Math.round(analysis.proteinGrams)} g protein, ${Math.round(analysis.fatGrams)} g fat, ${Math.round(analysis.caloriesKcal)} kcal. Diet fit: ${oneLine(analysis.dietFit)}`;
}

/** Collapses a possibly multi-line field to one prompt line. */
function oneLine(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function formatDietWeek(week: DietWeekSummary): string {
  const head = `- Week starting ${week.weekStart}: ${week.meals} ${week.meals === 1 ? "meal" : "meals"} over ${week.daysLogged} ${week.daysLogged === 1 ? "day" : "days"}`;
  if (week.nutritionDays === 0) {
    return `${head}; no estimated nutrition available.`;
  }
  return `${head}; averaged over ${week.nutritionDays} logged ${week.nutritionDays === 1 ? "day" : "days"}: ${week.carbsGramsPerDay ?? 0} g carbs, ${week.proteinGramsPerDay ?? 0} g protein, ${week.fatGramsPerDay ?? 0} g fat, ${week.caloriesKcalPerDay ?? 0} kcal per day.`;
}
