import { z } from "zod";
import { planDateSchema } from "./date.js";
import { timeZoneSchema } from "./user.js";

/** The maximum length accepted for an athlete's meal description. */
export const FOOD_DESCRIPTION_MAX_LENGTH = 2000;

/**
 * The diet goal shown when the athlete has not stated one. The coach assumes
 * maintenance so the calorie estimate always has a target to work toward.
 */
export const DEFAULT_DIET_GOAL = "Maintain current weight";

/**
 * The lowest total daily intake the app treats as a plausible coaching target.
 * It is a safety floor, not a recommended intake: a number below it almost
 * always means the coach returned a deficit or burned calories instead of the
 * day's total.
 */
export const MIN_PLAUSIBLE_CALORIES_KCAL = 1200;

/**
 * The coach's breakdown of a day's calorie allocation. Base metabolism is the
 * athlete's resting energy use, the workout requirement is the extra energy the
 * planned session burns, and the diet deficit is the amount subtracted to reach
 * the goal. A negative deficit is a planned surplus. The allocated intake is
 * base metabolism plus the workout requirement minus the deficit.
 */
export const calorieBreakdownSchema = z.object({
  basalMetabolismKcal: z.number().int().nonnegative().max(20000),
  workoutCaloriesKcal: z.number().int().nonnegative().max(20000),
  dietDeficitKcal: z.number().int().min(-20000).max(20000),
});

export type CalorieBreakdown = z.infer<typeof calorieBreakdownSchema>;

/** A plan value that can carry a calorie target, new shape or old. */
export interface PlannedCalories {
  /** The older whole-day total, still the fallback when no breakdown exists. */
  estimatedCaloriesKcal?: number | null | undefined;
  calorieBreakdown?: CalorieBreakdown | null | undefined;
}

/**
 * The coach's diet goal for the athlete and its judgement of the weight trend.
 * `assessment` is the coach's own reading of the tracked weights against the
 * logged calories and its earlier targets; the app never computes it.
 */
export const dietPlanSchema = z.object({
  /** The athlete's goal in their own terms, or maintenance when unstated. */
  goal: z.string().trim().min(1).max(500),
  /**
   * True when the athlete stated the goal themselves. False when the coach fell
   * back to `DEFAULT_DIET_GOAL`. Missing on plans stored before diet progress
   * targets, so readers fall back to the exact default wording.
   */
  goalProvided: z.boolean().optional(),
  /** The body weight the athlete named as their goal, when they named one. */
  goalWeightKg: z.number().positive().max(500).nullable().optional(),
  /** The body-fat percentage the athlete named as their goal, when they did. */
  goalBodyFatPercent: z.number().positive().max(75).nullable().optional(),
  /** The date the athlete expects to reach the goal, when they stated one. */
  goalDate: planDateSchema.nullable().optional(),
  /**
   * Why the plan deliberately does not reach a stated numeric goal, when the
   * goal is unrealistic or conflicts with another season goal. Null or absent
   * when the plan reaches the goal.
   */
  goalMissReason: z.string().trim().min(1).max(1000).nullable().optional(),
  /** The coach's judgement of whether the goal is on track. */
  assessment: z.string().trim().min(1).max(4000),
});

export type DietPlan = z.infer<typeof dietPlanSchema>;

/**
 * The coach's expected progress toward the diet goal at the end of a plan
 * period. The target belongs to the period's last day; either number may be
 * null when the coach cannot estimate it, and `note` always carries the
 * expected change in the coach's own words. The app never calculates these
 * values.
 */
export const dietProgressSchema = z.object({
  /** Expected body weight in kilograms at the end of the period. */
  targetWeightKg: z.number().positive().max(500).nullable().default(null),
  /** Expected body fat as a percentage at the end of the period. */
  targetBodyFatPercent: z.number().positive().max(75).nullable().default(null),
  /** The expected progress and why the period moves or holds the goal. */
  note: z.string().trim().min(1).max(1000),
});

export type DietProgress = z.infer<typeof dietProgressSchema>;

/**
 * The analysis photo is sent to the model at its full resolution, so it can be
 * much larger than the thumbnail kept for the food log. The source file is
 * capped at 15 MB in the browser, which leaves room for base64 overhead.
 */
export const FOOD_PHOTO_DATA_URL_MAX_LENGTH = 30_000_000;

export const foodPhotoDataUrlSchema = z
  .string()
  .max(FOOD_PHOTO_DATA_URL_MAX_LENGTH)
  .regex(
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/,
    "Expected a base64 JPEG, PNG or WebP data URL",
  );

/**
 * The coach's structured reading of one meal. The numbers are totals for the
 * whole meal; `meal` is the coach's description of what the athlete ate and
 * `dietFit` is its note on how the meal fits the athlete's goal.
 */
export const foodAnalysisSchema = z.object({
  meal: z.string().trim().min(1).max(4000),
  carbsGrams: z.number().finite().nonnegative().max(5000),
  proteinGrams: z.number().finite().nonnegative().max(2000),
  fatGrams: z.number().finite().nonnegative().max(2000),
  caloriesKcal: z.number().finite().nonnegative().max(20000),
  dietFit: z.string().trim().min(1).max(4000),
});

export type FoodAnalysis = z.infer<typeof foodAnalysisSchema>;

/** The JSON contract the food-analysis prompt asks the model to return. */
export const foodAnalysisResultSchema = foodAnalysisSchema;

export type FoodAnalysisResult = z.infer<typeof foodAnalysisResultSchema>;

/** One logged meal, as the Diet page and the dashboard receive it. */
export const foodEntrySchema = z.object({
  id: z.number().int().positive(),
  /** The meal instant as an ISO timestamp. */
  eatenAt: z.string().datetime(),
  /** The athlete's local calendar date, `YYYY-MM-DD`. */
  eatenDate: planDateSchema,
  /** The athlete's own description; null when the meal was logged by photo. */
  description: z.string().nullable(),
  /** Whether a thumbnail can be fetched from the entry's photo endpoint. */
  hasPhoto: z.boolean(),
  analysis: foodAnalysisSchema.nullable(),
  /** Why the coach could not analyse this meal, when it could not. */
  analysisError: z.string().nullable(),
  /**
   * When the meal was last saved, as an ISO timestamp. The photo endpoint adds
   * it to the URL so an edited photo is not served from the browser cache.
   */
  updatedAt: z.string().datetime(),
});

export type FoodEntry = z.infer<typeof foodEntrySchema>;

/**
 * One day of the diet log: the coach's calorie requirement, the calories the
 * athlete logged, and the resulting balance. `balanceKcal` is consumed minus
 * needed, so a negative number is a deficit and a positive one a surplus. It is
 * null when either side is unknown.
 */
export const dietDaySummarySchema = z.object({
  date: planDateSchema,
  /** The coach's estimated requirement for the day, when the plan covers it. */
  neededCaloriesKcal: z.number().int().nonnegative().nullable().default(null),
  /**
   * The coach's breakdown of the requirement, when the plan stored one. The
   * breakdown's sum is the allocated intake; older targets have none.
   */
  calorieBreakdown: calorieBreakdownSchema.nullable().default(null),
  /** Calories from analysed meals logged that day; null when none were logged. */
  consumedCaloriesKcal: z.number().int().nonnegative().nullable().default(null),
  /** Consumed minus needed; negative is a deficit, positive a surplus. */
  balanceKcal: z.number().int().nullable().default(null),
  /** The meals logged that day, newest first. */
  entries: z.array(foodEntrySchema).default([]),
});

export type DietDaySummary = z.infer<typeof dietDaySummarySchema>;

/** Response body of `GET /api/diet/summary`. */
export const dietSummaryResponseSchema = z.object({
  /** The coach's diet goal, or null when no plan has been generated. */
  goal: z.string().nullable().default(null),
  /**
   * Whether the athlete stated the goal. False when the plan shows the default
   * maintenance goal, so the Diet page can ask for a real goal.
   */
  goalProvided: z.boolean().default(false),
  /** The coach's judgement of the weight trend, or null without a plan. */
  assessment: z.string().nullable().default(null),
  /** Every day with a logged meal or a calorie target, newest first. */
  days: z.array(dietDaySummarySchema).default([]),
});

export type DietSummaryResponse = z.infer<typeof dietSummaryResponseSchema>;

/** Response body of `GET /api/diet/entries`. */
export const foodEntriesResponseSchema = z.object({
  entries: z.array(foodEntrySchema),
});

export type FoodEntriesResponse = z.infer<typeof foodEntriesResponseSchema>;

/**
 * Body of `POST /api/diet/entries`. `eatenAt` is the absolute meal instant in
 * ISO form; the server derives the athlete's local date and clock time from it
 * and `timezone`. `today` mirrors the client's effective day so the analysis
 * uses the same date as the rest of the app.
 *
 * `photoDataUrl` is the full-resolution image the API sends to the coach and
 * turns into the stored thumbnail. A meal may be a photo alone, so a
 * description is optional when a photo is present.
 */
export const foodEntryRequestSchema = z
  .object({
    eatenAt: z.string().datetime(),
    timezone: timeZoneSchema.optional(),
    today: planDateSchema.optional(),
    description: z
      .string()
      .trim()
      .max(FOOD_DESCRIPTION_MAX_LENGTH)
      .nullable()
      .optional(),
    photoDataUrl: foodPhotoDataUrlSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const description = value.description?.trim() ?? "";
    const hasPhoto =
      value.photoDataUrl !== undefined &&
      value.photoDataUrl !== null &&
      value.photoDataUrl !== "";
    if (description === "" && !hasPhoto) {
      ctx.addIssue({
        code: "custom",
        message: "Describe the meal or add a photo",
        path: ["description"],
      });
    }
  });

export type FoodEntryRequest = z.infer<typeof foodEntryRequestSchema>;

/**
 * Body of `PATCH /api/diet/entries/:id`. Every field is optional: an omitted
 * field keeps its stored value, `description: null` clears the description, and
 * omitting both photo fields keeps the current thumbnail. `photoDataUrl`
 * replaces the photo, while `removePhoto` clears it. Saving always asks the
 * coach to analyse the meal again, so an empty body re-assesses it unchanged.
 */
export const foodEntryUpdateRequestSchema = z
  .object({
    eatenAt: z.string().datetime().optional(),
    timezone: timeZoneSchema.optional(),
    today: planDateSchema.optional(),
    description: z
      .string()
      .trim()
      .max(FOOD_DESCRIPTION_MAX_LENGTH)
      .nullable()
      .optional(),
    photoDataUrl: foodPhotoDataUrlSchema.nullable().optional(),
    removePhoto: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const hasNewPhoto =
      value.photoDataUrl !== undefined &&
      value.photoDataUrl !== null &&
      value.photoDataUrl !== "";
    if (value.removePhoto === true && hasNewPhoto) {
      ctx.addIssue({
        code: "custom",
        message: "Send a new photo or remove the old one, not both",
        path: ["removePhoto"],
      });
    }
  });

export type FoodEntryUpdateRequest = z.infer<
  typeof foodEntryUpdateRequestSchema
>;

/**
 * A calorie estimate when it is plausible for a whole day, otherwise null. A
 * stored plan from before the prompt clarified the field can carry a deficit in
 * this slot, so every reader hides an implausible number rather than showing it
 * as the day's requirement.
 */
export function plausibleCaloriesKcal(
  value: number | null | undefined,
): number | null {
  return value !== null &&
    value !== undefined &&
    value >= MIN_PLAUSIBLE_CALORIES_KCAL
    ? value
    : null;
}

/**
 * The calories the breakdown allocates for the day: base metabolism plus the
 * workout requirement minus the diet deficit. The parts are the coach's
 * estimates, so this is the number every reader shows rather than trusting a
 * separate total that may not add up.
 */
export function allocatedCaloriesKcal(breakdown: CalorieBreakdown): number {
  return (
    breakdown.basalMetabolismKcal +
    breakdown.workoutCaloriesKcal -
    breakdown.dietDeficitKcal
  );
}

/**
 * The day's allocated calorie intake: the breakdown's sum when the coach
 * supplied one, otherwise the older `estimatedCaloriesKcal`. Null when the
 * result is missing or below the whole-day safety floor.
 */
export function plannedCaloriesKcal(value: PlannedCalories): number | null {
  if (value.calorieBreakdown !== null && value.calorieBreakdown !== undefined) {
    return plausibleCaloriesKcal(allocatedCaloriesKcal(value.calorieBreakdown));
  }
  return plausibleCaloriesKcal(value.estimatedCaloriesKcal);
}

/**
 * True when a goal is the default maintenance fallback rather than a goal the
 * athlete stated. Old plans do not carry `goalProvided`, so an exact default
 * wording identifies them; trailing punctuation is ignored.
 */
export function isDefaultDietGoal(goal: string | null | undefined): boolean {
  if (goal === null || goal === undefined) {
    return true;
  }
  const normalised = goal
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  return normalised === DEFAULT_DIET_GOAL.toLowerCase();
}
