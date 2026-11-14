/**
 * Time helpers for plan dates. All dates are `YYYY-MM-DD` strings and the
 * arithmetic is done in UTC so it is independent of the server's timezone. The
 * generic date arithmetic (`addDays`, `startOfWeek`, `weekDates`) lives in
 * `@killingit/shared`, as does the wall-clock conversion used here.
 */

import { zonedDateTime } from "@killingit/shared";

/** The local hour from which the next day's session is planned. */
const TOMORROW_CUTOFF_HOUR = 18;

/**
 * True when `candidate` happened after `recorded`. A missing candidate is never
 * newer, while any candidate is newer than a missing recorded timestamp. Both
 * sides are instants, so a string cannot slip in and compare lexically.
 */
export function isNewer(
  candidate: Date | null | undefined,
  recorded: Date | null | undefined,
): boolean {
  return (
    candidate != null &&
    (recorded == null || candidate.getTime() > recorded.getTime())
  );
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
  return zonedDateTime(now, timeZone).hour >= TOMORROW_CUTOFF_HOUR;
}

/**
 * One instant as the athlete's local calendar date and `HH:mm` clock time. A
 * missing or unknown zone falls back to UTC, so a bad setting can never stop a
 * write.
 */
export function localDateTimeInZone(
  instant: Date,
  timeZone: string | null | undefined,
): { date: string; time: string } {
  const { date, hour, minute } = zonedDateTime(instant, timeZone);
  return {
    date,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}
