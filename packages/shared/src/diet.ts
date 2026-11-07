import { z } from "zod";
import { planDateSchema } from "./date.js";
import { timeZoneSchema } from "./user.js";

/** The maximum length accepted for an athlete's meal description. */
export const FOOD_DESCRIPTION_MAX_LENGTH = 2000;

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
  /** The athlete's own description; null when the meal was logged by photo. */
  description: z.string().nullable(),
  /** Whether a thumbnail can be fetched from the entry's photo endpoint. */
  hasPhoto: z.boolean(),
  analysis: foodAnalysisSchema.nullable(),
  /** Why the coach could not analyse this meal, when it could not. */
  analysisError: z.string().nullable(),
});

export type FoodEntry = z.infer<typeof foodEntrySchema>;

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
