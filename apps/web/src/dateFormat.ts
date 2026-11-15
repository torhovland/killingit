/**
 * English date labels shared by the web app. A stored `YYYY-MM-DD` key is
 * parsed and formatted in UTC, so a date never shifts a day for an athlete
 * west of Greenwich, and each `Intl.DateTimeFormat` is created once instead of
 * per chart row or calendar cell.
 */

const DATE_LOCALE = "en-US";

const SHORT_MONTH = new Intl.DateTimeFormat(DATE_LOCALE, {
  month: "short",
  timeZone: "UTC",
});

const SHORT_MONTH_YEAR = new Intl.DateTimeFormat(DATE_LOCALE, {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

const LONG_MONTH_YEAR = new Intl.DateTimeFormat(DATE_LOCALE, {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const WEEKDAY_DAY_MONTH = new Intl.DateTimeFormat(DATE_LOCALE, {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const WEEKDAY_DAY_MONTH_YEAR = new Intl.DateTimeFormat(DATE_LOCALE, {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

interface MonthParts {
  year: number;
  month: number;
}

function monthParts(key: string): MonthParts | undefined {
  const match = MONTH_KEY.exec(key);
  if (match?.[1] === undefined || match[2] === undefined) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year, month } : undefined;
}

/** The first day of a month, built in UTC so no device zone can move it. */
function utcMonth({ year, month }: MonthParts): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

/** A short month name for a `YYYY-MM` key, such as `Jan`. */
export function formatShortMonth(key: string): string {
  const parts = monthParts(key);
  return parts === undefined ? key : SHORT_MONTH.format(utcMonth(parts));
}

/** A short month and two-digit year for a `YYYY-MM` key, such as `Jan 26`. */
export function formatShortMonthYear(key: string): string {
  const parts = monthParts(key);
  return parts === undefined ? key : SHORT_MONTH_YEAR.format(utcMonth(parts));
}

/** A long month and year for a `YYYY-MM` key, such as `January 2026`. */
export function formatLongMonthYear(key: string): string {
  const parts = monthParts(key);
  return parts === undefined ? key : LONG_MONTH_YEAR.format(utcMonth(parts));
}

/** A day and short month for a `YYYY-MM-DD` key, such as `1 Jan`. */
export function formatDayMonth(key: string): string {
  const match = DATE_KEY.exec(key);
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
  ) {
    return key;
  }
  const parts = monthParts(`${match[1]}-${match[2]}`);
  if (parts === undefined) {
    return key;
  }
  return `${Number(match[3])} ${SHORT_MONTH.format(utcMonth(parts))}`;
}

/** A day, short month and year for a `YYYY-MM-DD` key, such as `1 Jan 2026`. */
export function formatDayMonthYear(key: string): string {
  const [year] = key.split("-");
  const day = formatDayMonth(key);
  return year === undefined ? day : `${day} ${year}`;
}

/** A short weekday, day and month, such as `Thu, Jan 1`. */
export function formatWeekdayDayMonth(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : WEEKDAY_DAY_MONTH.format(parsed);
}

/** A short weekday, day, month and year, such as `Thu, Jan 1, 2026`. */
export function formatWeekdayDayMonthYear(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : WEEKDAY_DAY_MONTH_YEAR.format(parsed);
}
