import type { PlanGenerationStatus } from "@killingit/shared";

/** How often a live generation refreshes its status row. */
export const GENERATION_HEARTBEAT_MS = 15_000;

/**
 * A running generation that has not refreshed its status for this long is
 * assumed to belong to a process that stopped (for example a restart or a
 * crashed instance). It must not block the athlete from trying again.
 */
export const STALE_GENERATION_MS = 2 * 60 * 1000;

/**
 * How many times an abandoned run is restarted automatically before the athlete
 * sees an error. One retry hides a single deploy or instance shutdown without
 * re-billing the model in a loop.
 */
export const MAX_AUTO_RETRIES = 1;

/** True when a `running` status has gone quiet for longer than the lease. */
export function isStaleRunning(
  status: PlanGenerationStatus,
  now = Date.now(),
): boolean {
  if (status.status !== "running") {
    return false;
  }
  const updatedAt = Date.parse(status.updatedAt);
  return !Number.isFinite(updatedAt) || now - updatedAt > STALE_GENERATION_MS;
}
