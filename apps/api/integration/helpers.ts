import { loadThresholdHistoryForUser } from "../src/metrics/store.js";

/**
 * Walks a thrown database error's cause chain for the PostgreSQL SQLSTATE.
 * Drizzle and pg wrap the driver error, so the top-level object does not carry
 * the code.
 */
export function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null; depth += 1) {
    if (typeof current !== "object") {
      return undefined;
    }
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Every stored threshold point, read through the page-facing loader. */
export async function thresholdPointsOf(userId: number) {
  return (await loadThresholdHistoryForUser(userId, "2999-12-31")).points;
}
