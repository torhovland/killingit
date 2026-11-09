import { addDays } from "@killingit/shared";
import { dbUserStore, type StoredUser } from "../users/store.js";
import {
  DIET_SUMMARY_DAYS,
  summarizeDiet,
  type DietPromptContext,
  type DietSourceEntry,
} from "./summary.js";
import { dbFoodEntryStore } from "./store.js";

/** The loaders behind the diet context, injectable for tests. */
export interface DietContextDependencies {
  /** Meals on or after a local date, oldest first. */
  loadEntries?: (
    userId: number,
    sinceDate: string,
  ) => Promise<readonly DietSourceEntry[]>;
  loadUser?: (userId: number) => Promise<StoredUser | null>;
}

/**
 * The food log for every coach prompt. Returns null when the athlete has not
 * opted in, nothing has been logged, or the read fails: nutrition is advisory
 * and must never stop a plan or a reply.
 */
export async function loadDietContext(
  userId: number,
  today: string,
  deps: DietContextDependencies = {},
): Promise<DietPromptContext | null> {
  const loadUser = deps.loadUser ?? ((id: number) => dbUserStore.getById(id));
  const loadEntries =
    deps.loadEntries ??
    ((id: number, sinceDate: string) =>
      dbFoodEntryStore.listSince(id, sinceDate));

  try {
    const user = await loadUser(userId);
    if (user === null || !user.dietAdvice) {
      return null;
    }
    const entries = await loadEntries(
      userId,
      addDays(today, -DIET_SUMMARY_DAYS),
    );
    if (entries.length === 0) {
      return { meals: [], weeks: [] };
    }
    return summarizeDiet(entries, today);
  } catch (err) {
    console.error("[diet] could not read the food log:", err);
    return null;
  }
}
