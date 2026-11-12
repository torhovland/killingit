/**
 * Helpers for the athlete's display time zone. The stored setting is an IANA
 * zone (for example `Europe/Oslo`); a missing or unknown value falls back to
 * the device's zone. The wall-clock conversion itself lives in
 * `@killingit/shared` and falls back to UTC for a zone it cannot resolve.
 */

import { zonedDateTime } from "@killingit/shared";

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
  const { date: localDate, hour, minute } = zonedDateTime(date, timeZone);
  return `${localDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
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

/** The zone's offset from UTC at an instant, in milliseconds. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const {
    date: localDate,
    hour,
    minute,
    second,
  } = zonedDateTime(date, timeZone);
  const [year, month, day] = localDate.split("-").map(Number);
  const asUtc = Date.UTC(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1,
    hour,
    minute,
    second,
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
