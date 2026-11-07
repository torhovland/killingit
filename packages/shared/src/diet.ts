import { z } from "zod";
import { planDateSchema } from "./date.js";
import { timeZoneSchema } from "./user.js";

/** The maximum length accepted for an athlete's meal description. */
export const FOOD_DESCRIPTION_MAX_LENGTH = 2000;

/**
 * A photo must be a base64 data URL of a format the browser produced and every
 * supported model can read. The browser downsizes and re-encodes the image
 * before upload, so this bound is generous.
 */
export const FOOD_PHOTO_DATA_URL_MAX_LENGTH = 8_000_000;

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
  description: z.string(),
  /** Whether a photo can be fetched from the entry's photo endpoint. */
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
 */
export const foodEntryRequestSchema = z.object({
  eatenAt: z.string().datetime(),
  timezone: timeZoneSchema.optional(),
  today: planDateSchema.optional(),
  description: z.string().trim().min(1).max(FOOD_DESCRIPTION_MAX_LENGTH),
  photoDataUrl: foodPhotoDataUrlSchema.nullable().optional(),
});

export type FoodEntryRequest = z.infer<typeof foodEntryRequestSchema>;
