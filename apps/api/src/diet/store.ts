import type { FoodAnalysis } from "@killingit/shared";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "../db/index.js";
import { foodEntries } from "../db/schema.js";

/** One stored meal with its coach analysis. */
export interface StoredFoodEntry {
  id: number;
  eatenAt: Date;
  eatenDate: string;
  eatenTime: string;
  description: string;
  photoDataUrl: string | null;
  analysis: FoodAnalysis | null;
  model: string | null;
  analysisError: string | null;
  createdAt: Date;
}

/** The fields written when a meal is logged. */
export interface NewFoodEntry {
  eatenAt: Date;
  eatenDate: string;
  eatenTime: string;
  description: string;
  photoDataUrl: string | null;
  analysis: FoodAnalysis | null;
  model: string | null;
  analysisError: string | null;
}

/**
 * Meal storage behind a small interface so the routes and prompt context are
 * tested without a database.
 */
export interface FoodEntryStore {
  create(userId: number, entry: NewFoodEntry): Promise<StoredFoodEntry>;
  /** Every meal, newest first, for the Diet page. */
  listForUser(userId: number): Promise<StoredFoodEntry[]>;
  /** Meals on or after a local date, oldest first, for prompt summaries. */
  listSince(userId: number, sinceDate: string): Promise<StoredFoodEntry[]>;
  /** The stored photo data URL for one meal, or null. */
  photo(userId: number, id: number): Promise<string | null>;
}

function toStoredEntry(row: typeof foodEntries.$inferSelect): StoredFoodEntry {
  return {
    id: row.id,
    eatenAt: row.eatenAt,
    eatenDate: row.eatenDate,
    eatenTime: row.eatenTime,
    description: row.description,
    photoDataUrl: row.photoDataUrl,
    analysis: row.analysis,
    model: row.model,
    analysisError: row.analysisError,
    createdAt: row.createdAt,
  };
}

export const dbFoodEntryStore: FoodEntryStore = {
  async create(userId, entry) {
    const [row] = await db
      .insert(foodEntries)
      .values({
        userId,
        eatenAt: entry.eatenAt,
        eatenDate: entry.eatenDate,
        eatenTime: entry.eatenTime,
        description: entry.description,
        photoDataUrl: entry.photoDataUrl,
        analysis: entry.analysis,
        model: entry.model,
        analysisError: entry.analysisError,
      })
      .returning();
    if (row === undefined) {
      throw new Error("Could not store the meal.");
    }
    return toStoredEntry(row);
  },

  async listForUser(userId) {
    const rows = await db
      .select()
      .from(foodEntries)
      .where(eq(foodEntries.userId, userId))
      // Newest first. eaten_at is the authoritative ordering; the local date
      // and time are a display and summary convenience.
      .orderBy(desc(foodEntries.eatenAt));
    return rows.map(toStoredEntry);
  },

  async listSince(userId, sinceDate) {
    const rows = await db
      .select()
      .from(foodEntries)
      .where(
        and(
          eq(foodEntries.userId, userId),
          gte(foodEntries.eatenDate, sinceDate),
        ),
      )
      .orderBy(asc(foodEntries.eatenAt));
    return rows.map(toStoredEntry);
  },

  async photo(userId, id) {
    const [row] = await db
      .select({ photoDataUrl: foodEntries.photoDataUrl })
      .from(foodEntries)
      .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, id)))
      .limit(1);
    return row?.photoDataUrl ?? null;
  },
};
