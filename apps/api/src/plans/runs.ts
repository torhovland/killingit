/** The in-process owner of a user's live coach run. */
interface ActiveRun {
  runId: string;
  controller: AbortController;
}

/**
 * Only the newest run for a user may keep working. The map is process-local;
 * the run id stored on `plan_generations` is the cross-instance fence, so an
 * old run on another instance still stops before it writes.
 */
const activeRuns = new Map<number, ActiveRun>();

/** Aborts the user's current run, if any, and starts a fresh one. */
export function claimRun(userId: number): {
  runId: string;
  signal: AbortSignal;
} {
  abortRun(userId);
  const controller = new AbortController();
  const runId = crypto.randomUUID();
  activeRuns.set(userId, { runId, controller });
  return { runId, signal: controller.signal };
}

/** Stops the current run for a user before a newer run takes over. */
export function abortRun(userId: number): void {
  activeRuns.get(userId)?.controller.abort();
  activeRuns.delete(userId);
}

/** Releases the map entry only when this run is still the active one. */
export function releaseRun(userId: number, runId: string): void {
  if (activeRuns.get(userId)?.runId === runId) {
    activeRuns.delete(userId);
  }
}
