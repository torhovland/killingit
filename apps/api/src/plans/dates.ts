/**
 * Time-zone helpers for plan dates. All dates are `YYYY-MM-DD` strings and the
 * arithmetic is done in UTC so it is independent of the server's timezone. The
 * generic date arithmetic (`addDays`, `startOfWeek`, `weekDates`) lives in
 * `@killingit/shared`.
 */

/** The local hour from which the next day's session is planned. */
const TOMORROW_CUTOFF_HOUR = 18;

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

/**
 * One instant as the athlete's local calendar date and clock time. Falls back
 * to UTC when no zone is set or the zone is unknown, so a bad setting can never
 * stop a write.
 */
export function localDateTimeInZone(
  instant: Date,
  timeZone: string | null | undefined,
): { date: string; time: string } {
  const parts = zoneParts(instant, timeZone);
  if (parts !== null) {
    return { date: parts.date, time: `${parts.hour}:${parts.minute}` };
  }
  return {
    date: instant.toISOString().slice(0, 10),
    time: instant.toISOString().slice(11, 16),
  };
}

/** The wall-clock parts of an instant in a zone, or null when unavailable. */
function zoneParts(
  instant: Date,
  timeZone: string | null | undefined,
): { date: string; hour: string; minute: string } | null {
  if (timeZone === null || timeZone === undefined || timeZone.trim() === "") {
    return null;
  }
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const value = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? "";
    const year = value("year");
    const month = value("month");
    const day = value("day");
    const hour = value("hour");
    const minute = value("minute");
    if ([year, month, day, hour, minute].some((part) => part === "")) {
      return null;
    }
    return { date: `${year}-${month}-${day}`, hour, minute };
  } catch {
    return null;
  }
}
