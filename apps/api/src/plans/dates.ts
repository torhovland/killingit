/**
 * Calendar helpers for plan dates. All dates are `YYYY-MM-DD` strings and the
 * arithmetic is done in UTC so it is independent of the server's timezone.
 */

/** The local hour from which the next day's session is planned. */
const TOMORROW_CUTOFF_HOUR = 18;

/** Returns the Monday of the week containing `date`. */
export function startOfWeek(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const weekday = parsed.getUTCDay(); // 0 = Sunday, 1 = Monday, …
  const offset = weekday === 0 ? -6 : 1 - weekday;
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

/** Adds `days` (which may be negative) to a `YYYY-MM-DD` date. */
export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * True when the athlete's local clock has reached the point where tomorrow's
 * session should be planned. Server-triggered updates use this so they plan the
 * same levels as the dashboard, even when they run without a client flag.
 */
export function isAfterPlanTomorrowCutoff(
  timeZone: string | null | undefined,
  now = new Date(),
): boolean {
  return localHour(timeZone, now) >= TOMORROW_CUTOFF_HOUR;
}

/** The wall-clock hour in `timeZone`, falling back to UTC. */
function localHour(timeZone: string | null | undefined, now: Date): number {
  if (timeZone !== null && timeZone !== undefined) {
    try {
      const formatted = new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(now);
      const hour = Number(formatted);
      if (Number.isInteger(hour)) {
        return hour;
      }
    } catch {
      // An unknown time zone must not stop plan generation.
    }
  }
  return now.getUTCHours();
}

/** The seven calendar dates in the week starting on `startDate`. */
export function weekDates(startDate: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(startDate, index));
}
