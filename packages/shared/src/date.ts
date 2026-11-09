import { z } from "zod";

/** A calendar date in `YYYY-MM-DD` form. */
export const planDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

export type PlanDate = z.infer<typeof planDateSchema>;

/**
 * Adds `days` (which may be negative) to a `YYYY-MM-DD` date. The arithmetic
 * is done in UTC so it is independent of the caller's time zone.
 */
export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Returns the Monday of the week containing `date`. */
export function startOfWeek(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const weekday = parsed.getUTCDay(); // 0 = Sunday, 1 = Monday, …
  const offset = weekday === 0 ? -6 : 1 - weekday;
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

/** The seven calendar dates in the week starting on `startDate`. */
export function weekDates(startDate: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(startDate, index));
}
