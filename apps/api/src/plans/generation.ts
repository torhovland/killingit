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
 * Raised when a newer run has taken ownership of the generation row. The old
 * run must unwind without writing: its plan, replies and status are stale.
 */
export class GenerationSupersededError extends Error {
  constructor() {
    super("a newer coach run started");
    this.name = "GenerationSupersededError";
  }
}

/** True when an error means the current run no longer owns the work. */
export function isGenerationSuperseded(err: unknown): boolean {
  return (
    err instanceof GenerationSupersededError ||
    (err instanceof Error && err.name === "GenerationSupersededError")
  );
}

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
