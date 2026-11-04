import type { AthleteEvent, AthleteEventKind } from "@killingit/shared";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { athleteEvents } from "../db/schema.js";

/**
 * Loads every dated goal and event stored for the account, earliest first.
 * These are facts the athlete stated, so nothing here is derived from the plan.
 */
export async function loadAthleteEvents(
  userId: number,
): Promise<AthleteEvent[]> {
  const rows = await db
    .select()
    .from(athleteEvents)
    .where(eq(athleteEvents.userId, userId))
    .orderBy(asc(athleteEvents.startDate));
  return rows.map((row) => ({
    startDate: row.startDate,
    endDate: row.endDate,
    title: row.title,
    kind: row.kind as AthleteEventKind,
  }));
}

/**
 * Replaces every stored event for the account. The reading sees all of the
 * athlete's text, so a successful reading is authoritative: an event edited out
 * of a comment is not returned and disappears. A failed reading never reaches
 * this function, so the previous list survives a model or provider outage.
 */
export async function replaceAthleteEvents(
  userId: number,
  events: readonly AthleteEvent[],
): Promise<void> {
  const seen = new Set<string>();
  const deduped = events.filter((event) => {
    const key = `${event.startDate}\u0000${event.endDate ?? ""}\u0000${event.title}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  await db.transaction(async (tx) => {
    await tx.delete(athleteEvents).where(eq(athleteEvents.userId, userId));
    if (deduped.length === 0) {
      return;
    }
    const now = new Date();
    await tx.insert(athleteEvents).values(
      deduped.map((event) => ({
        userId,
        startDate: event.startDate,
        endDate: event.endDate,
        title: event.title,
        kind: event.kind,
        createdAt: now,
        updatedAt: now,
      })),
    );
  });
}
