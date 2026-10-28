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
