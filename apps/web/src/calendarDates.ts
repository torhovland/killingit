/**
 * Month-grid helpers for the calendar page. Dates stay in `YYYY-MM-DD` form and
 * arithmetic is done in UTC, matching the rest of the app's plan dates.
 */

/** The `YYYY-MM` month containing a `YYYY-MM-DD` date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Moves a `YYYY-MM` month by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split("-").map(Number);
  const shifted = new Date(
    Date.UTC(year ?? 0, (monthIndex ?? 1) - 1 + delta, 1),
  );
  return shifted.toISOString().slice(0, 7);
}

/** Keeps a month inside the inclusive `min`/`max` month bounds. */
export function clampMonth(month: string, min: string, max: string): string {
  if (month < min) {
    return min;
  }
  return month > max ? max : month;
}

/** Adds days (which may be negative) to a `YYYY-MM-DD` date. */
function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** One cell in the month grid, including the leading and trailing days. */
export interface MonthCell {
  date: string;
  inMonth: boolean;
}

/**
 * Six Monday-start weeks covering the month, so every month has a stable grid
 * height and the first weekday line never jumps between months.
 */
export function buildMonthGrid(month: string): MonthCell[] {
  const first = `${month}-01`;
  const parsed = new Date(`${first}T00:00:00Z`);
  const weekday = parsed.getUTCDay(); // 0 = Sunday, 1 = Monday, …
  const offset = weekday === 0 ? -6 : 1 - weekday;
  const start = addDays(first, offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index);
    return { date, inMonth: monthOf(date) === month };
  });
}

/** A human-readable month heading, e.g. "October 2026". */
export function formatMonth(month: string): string {
  const parsed = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return month;
  }
  return parsed.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A short day number for a grid cell. */
export function dayNumber(date: string): number {
  return Number(date.slice(8, 10));
}
