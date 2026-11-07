/**
 * Helpers for the athlete's display time zone. The stored setting is an IANA
 * zone (for example `Europe/Oslo`); a missing or unknown value falls back to
 * the device's zone.
 */

/** The device's IANA time zone, or UTC when the runtime cannot report one. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Resolves a stored setting into a usable IANA zone. */
export function resolveTimeZone(setting?: string | null): string {
  if (!setting) {
    return browserTimeZone();
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: setting });
    return setting;
  } catch {
    return browserTimeZone();
  }
}

/** The `YYYY-MM-DDTHH:mm` value a `datetime-local` input expects. */
export function toWallClockValue(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  if (parts !== null) {
    return `${parts.date}T${parts.hour}:${parts.minute}`;
  }
  const localDate = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  const localTime = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ].join(":");
  return `${localDate}T${localTime}`;
}

/**
 * Converts a wall-clock `datetime-local` value in an IANA zone to an absolute
 * ISO instant. The offset is resolved twice so a value near a DST change keeps
 * the wall-clock time the athlete chose.
 */
export function wallClockToIso(value: string, timeZone: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
  ) {
    return new Date(value).toISOString();
  }
  const utcGuess = Date.parse(`${match[1]}T${match[2]}:${match[3]}:00Z`);
  if (Number.isNaN(utcGuess)) {
    return new Date(value).toISOString();
  }
  const first = zoneOffsetMs(new Date(utcGuess), timeZone);
  let candidate = utcGuess - first;
  const second = zoneOffsetMs(new Date(candidate), timeZone);
  if (second !== first) {
    candidate = utcGuess - second;
  }
  return new Date(candidate).toISOString();
}

interface ZonedParts {
  date: string;
  hour: string;
  minute: string;
  second: string;
}

function zonedParts(date: Date, timeZone: string): ZonedParts | null {
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
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? "";
    const year = value("year");
    const month = value("month");
    const day = value("day");
    const hour = value("hour");
    const minute = value("minute");
    const second = value("second");
    if ([year, month, day, hour, minute, second].some((part) => part === "")) {
      return null;
    }
    return {
      date: `${year}-${month}-${day}`,
      hour,
      minute,
      second,
    };
  } catch {
    return null;
  }
}

/** The zone's offset from UTC at an instant, in milliseconds. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  if (parts === null) {
    return 0;
  }
  const [year, month, day] = parts.date.split("-").map(Number);
  const asUtc = Date.UTC(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1,
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Formats an ISO timestamp in the given zone without a zone identifier. */
export function formatDateTime(iso: string, timeZone: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}
