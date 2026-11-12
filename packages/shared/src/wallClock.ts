/**
 * One wall-clock reading of an instant in an IANA time zone. The API and the
 * web app share this conversion so their handling of an unknown zone cannot
 * drift apart.
 */
export interface ZonedDateTime {
  /** The local calendar date in `YYYY-MM-DD` form. */
  date: string;
  /** The local hour, 0–23. */
  hour: number;
  /** The local minute, 0–59. */
  minute: number;
  /** The local second, 0–59. */
  second: number;
}

/**
 * Reads an instant as the wall clock of an IANA time zone. A missing, empty or
 * unknown zone falls back to UTC, consistently on both sides of the app, so a
 * bad setting can never stop a write or a plan.
 *
 * The seconds are part of the result because resolving a zone's UTC offset for
 * a wall-clock `datetime-local` value needs the complete reading.
 */
export function zonedDateTime(
  instant: Date,
  timeZone?: string | null,
): ZonedDateTime {
  if (timeZone !== null && timeZone !== undefined && timeZone.trim() !== "") {
    try {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(instant);
      const value = (type: Intl.DateTimeFormatPartTypes): string =>
        parts.find((part) => part.type === type)?.value ?? "";
      const year = value("year");
      const month = value("month");
      const day = value("day");
      const hour = value("hour");
      const minute = value("minute");
      const second = value("second");
      if (
        [year, month, day, hour, minute, second].every((part) => part !== "")
      ) {
        return {
          date: `${year}-${month}-${day}`,
          hour: Number(hour),
          minute: Number(minute),
          second: Number(second),
        };
      }
    } catch {
      // An unknown time zone must not stop a write or a plan.
    }
  }
  return {
    date: instant.toISOString().slice(0, 10),
    hour: instant.getUTCHours(),
    minute: instant.getUTCMinutes(),
    second: instant.getUTCSeconds(),
  };
}
