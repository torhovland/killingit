import { foodEntrySchema, type FoodEntry } from "@killingit/shared";
import type { StoredFoodEntry } from "./store.js";

/** The public shape of one logged meal. */
export function toFoodEntry(entry: StoredFoodEntry): FoodEntry {
  return foodEntrySchema.parse({
    id: entry.id,
    eatenAt: entry.eatenAt.toISOString(),
    eatenDate: entry.eatenDate,
    description: entry.description,
    hasPhoto: entry.thumbnailDataUrl !== null,
    analysis: entry.analysis,
    analysisError: entry.analysisError,
    updatedAt: entry.updatedAt.toISOString(),
  });
}
