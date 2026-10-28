/**
 * Display formatting for calendar dates and timestamps. Calendar dates are
 * `YYYY-MM-DD` in the plan; the app shows them as `d. MMM YYYY` (for example
 * `1. Oct 2026`). Clock times always use a 24-hour clock.
 */

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function monthName(month: number): string | undefined {
  return MONTH_NAMES[month - 1];
}

/**
 * A `YYYY-MM-DD` date (or a timestamp that starts with one) as `d. MMM YYYY`,
 * for example `1. Oct 2026`.
 */
export function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  const month = monthName(Number(match?.[2]));
  if (match === null || month === undefined) {
    return date;
  }
  return `${Number(match[3])}. ${month} ${match[1]}`;
}

/** A `YYYY-MM` month as `MMM YYYY`, for example `Oct 2026`. */
export function formatMonth(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const name = monthName(Number(match?.[2]));
  if (match === null || name === undefined) {
    return month;
  }
  return `${name} ${match[1]}`;
}

/**
 * An ISO timestamp in the given zone as `d. MMM YYYY, HH:mm`. The zone's
 * calendar date is used, so a late-evening UTC timestamp can fall on the next
 * day locally.
 */
export function formatDateTime(iso: string, timeZone: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  try {
    return formatTimestamp(parsed, timeZone);
  } catch {
    return formatTimestamp(parsed, "UTC");
  }
}

function formatTimestamp(parsed: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = value("year");
  const month = monthName(Number(value("month")));
  const day = value("day");
  const hour = value("hour");
  const minute = value("minute");
  if (
    year === "" ||
    month === undefined ||
    day === "" ||
    hour === "" ||
    minute === ""
  ) {
    return parsed.toISOString();
  }
  return `${Number(day)}. ${month} ${year}, ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}
