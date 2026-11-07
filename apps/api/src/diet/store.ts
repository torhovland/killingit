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
  description: string | null;
  thumbnailDataUrl: string | null;
  analysis: FoodAnalysis | null;
  model: string | null;
  analysisError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The fields written when a meal is logged. */
export interface NewFoodEntry {
  eatenAt: Date;
  eatenDate: string;
  eatenTime: string;
  description: string | null;
  thumbnailDataUrl: string | null;
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
  /** The stored thumbnail data URL for one meal, or null. */
  photo(userId: number, id: number): Promise<string | null>;
  /** One meal owned by the user, or null when it does not exist. */
  findForUser(userId: number, id: number): Promise<StoredFoodEntry | null>;
  /** Replaces a meal's saved fields, or returns null when it does not exist. */
  update(
    userId: number,
    id: number,
    entry: NewFoodEntry,
  ): Promise<StoredFoodEntry | null>;
}

function toStoredEntry(row: typeof foodEntries.$inferSelect): StoredFoodEntry {
  return {
    id: row.id,
    eatenAt: row.eatenAt,
    eatenDate: row.eatenDate,
    eatenTime: row.eatenTime,
    description: row.description,
    thumbnailDataUrl: row.thumbnailDataUrl,
    analysis: row.analysis,
    model: row.model,
    analysisError: row.analysisError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
        thumbnailDataUrl: entry.thumbnailDataUrl,
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
      .select({ thumbnailDataUrl: foodEntries.thumbnailDataUrl })
      .from(foodEntries)
      .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, id)))
      .limit(1);
    return row?.thumbnailDataUrl ?? null;
  },

  async findForUser(userId, id) {
    const [row] = await db
      .select()
      .from(foodEntries)
      .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, id)))
      .limit(1);
    return row === undefined ? null : toStoredEntry(row);
  },

  async update(userId, id, entry) {
    const [row] = await db
      .update(foodEntries)
      .set({
        eatenAt: entry.eatenAt,
        eatenDate: entry.eatenDate,
        eatenTime: entry.eatenTime,
        description: entry.description,
        thumbnailDataUrl: entry.thumbnailDataUrl,
        analysis: entry.analysis,
        model: entry.model,
        analysisError: entry.analysisError,
        updatedAt: new Date(),
      })
      .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, id)))
      .returning();
    return row === undefined ? null : toStoredEntry(row);
  },
};
