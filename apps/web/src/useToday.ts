/**
 * Date override for "today". In production the app always uses the browser's
 * real clock; in development and test environments a date stored in
 * `localStorage` can stand in for today so plans can be exercised as if the
 * athlete visited on a future (or past) day. The override is controlled by
 * `VITE_APP_ENV`.
 */

const STORAGE_KEY = "killingit.dev.today-override";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface Today {
  /** The effective date in `YYYY-MM-DD` form. */
  today: string;
  /** Whether the local time is after 18:00. */
  isAfter18: boolean;
  /** Whether the date came from the override. */
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

export type AppEnvironment = "Development" | "Test" | "Production";

/**
 * Resolves the deployment environment from a configured value and a dev flag.
 * Pure so it can be tested without Vite's `import.meta.env`.
 */
export function resolveAppEnvironment(
  configured: string | undefined,
  isDev: boolean,
): AppEnvironment {
  if (
    configured === "Development" ||
    configured === "Test" ||
    configured === "Production"
  ) {
    return configured;
  }
  return isDev ? "Development" : "Production";
}

/**
 * The deployment environment. Defaults to "Development" when running the Vite
 * dev server and "Production" for a plain build, so a misconfigured build never
 * accidentally exposes the override in production.
 */
export function appEnvironment(): AppEnvironment {
  return resolveAppEnvironment(
    import.meta.env.VITE_APP_ENV,
    import.meta.env.DEV,
  );
}

/** Whether the today override is allowed in this environment. */
export function isDateOverrideAllowed(
  env: AppEnvironment = appEnvironment(),
): boolean {
  return env === "Development" || env === "Test";
}

/** Reads the date override. Returns null outside development/test or when unset. */
export function readTodayOverride(): string | null {
  if (!isDateOverrideAllowed() || typeof localStorage === "undefined") {
    return null;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored !== null && DATE_PATTERN.test(stored) ? stored : null;
}

/** Writes or clears the date override. No-op outside development/test. */
export function setTodayOverride(date: string | null): void {
  if (!isDateOverrideAllowed() || typeof localStorage === "undefined") {
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
