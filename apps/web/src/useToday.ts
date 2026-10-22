/**
 * Development-only override for "today". In production the app always uses the
 * browser's real clock; in development a date stored in `localStorage` can
 * stand in for today so plans can be exercised as if the athlete visited on a
 * future (or past) day.
 */

const STORAGE_KEY = "killingit.dev.today-override";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface Today {
  /** The effective date in `YYYY-MM-DD` form. */
  today: string;
  /** Whether the local time is after 18:00. */
  isAfter18: boolean;
  /** Whether the date came from the development override. */
  isOverridden: boolean;
}

/**
 * Resolves the effective "today" from a clock reading and an optional
 * `YYYY-MM-DD` override. Pure so it can be tested without a browser.
 */
export function resolveToday(now: Date, override: string | null): Today {
  const actualToday = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

  return {
    today: override ?? actualToday,
    isAfter18: now.getHours() >= 18,
    isOverridden: override !== null,
  };
}

/** Reads the dev override. Returns null outside development or when unset. */
export function readTodayOverride(): string | null {
  if (!import.meta.env.DEV || typeof localStorage === "undefined") {
    return null;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored !== null && DATE_PATTERN.test(stored) ? stored : null;
}

/** Writes or clears the dev override. No-op outside development. */
export function setTodayOverride(date: string | null): void {
  if (!import.meta.env.DEV || typeof localStorage === "undefined") {
    return;
  }
  if (date === null) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, date);
}

/** Returns the effective "today" date and time-of-day flag. */
export function getToday(): Today {
  return resolveToday(new Date(), readTodayOverride());
}
