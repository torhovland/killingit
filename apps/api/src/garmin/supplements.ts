import { syncGarminMetrics, type GarminCredentials } from "./client.js";
import { syncGarminDailyHistory } from "./dailySync.js";
import { recordGarminBodyMetrics, recordGarminFtp } from "../metrics/store.js";

/** The sidecar calls and stores one supplementary pass uses. */
export interface GarminSupplementDependencies {
  syncMetrics?: typeof syncGarminMetrics;
  saveMetrics?: typeof recordGarminBodyMetrics;
  saveFtp?: typeof recordGarminFtp;
  syncDaily?: typeof syncGarminDailyHistory;
}

/**
 * Supplementary passes still running, keyed by account. One pass per account at
 * a time, so a visit that arrives mid-pass joins it instead of writing the same
 * metrics twice. Process-local, like the plan run registry: another instance
 * may run its own pass. An entry is removed when its pass settles, so the map
 * holds only live passes.
 */
const runningSupplements = new Map<number, Promise<void>>();

/**
 * Refreshes the data that supplements the activity sync: Garmin weigh-ins with
 * their historic FTP, then the daily health and recovery backfill. Both are
 * fail-open, because the activity sync still counts without them and neither may
 * fail the feed that triggered it. `today` is the athlete's local calendar date,
 * so the daily-health window ends on the day the athlete is living.
 */
export async function syncGarminSupplements(
  userId: number,
  credentials: GarminCredentials,
  today: string,
  deps: GarminSupplementDependencies = {},
): Promise<void> {
  const syncMetrics = deps.syncMetrics ?? syncGarminMetrics;
  const saveMetrics = deps.saveMetrics ?? recordGarminBodyMetrics;
  const saveFtp = deps.saveFtp ?? recordGarminFtp;
  const syncDaily = deps.syncDaily ?? syncGarminDailyHistory;

  try {
    const snapshot = await syncMetrics(credentials);
    await saveMetrics(userId, snapshot.metrics);
    await saveFtp(userId, snapshot.ftp);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[garmin] could not sync body metrics: ${detail}`);
  }

  try {
    await syncDaily({ userId, credentials, today });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[garmin] could not sync daily health metrics: ${detail}`);
  }
}

/**
 * Starts one supplementary pass in the background and returns at once, so a
 * slow daily-health backfill never holds a response. See ADR 0039.
 *
 * The pass takes no request signal or context, so it may keep running after the
 * response, and anything it throws is logged instead of rejecting the returned
 * promise: a background task must not fail a response that is already written.
 * An account whose pass is still running joins it rather than starting a second
 * one, so two requests never write the same metrics at once.
 */
export function startGarminSupplements(
  userId: number,
  pass: () => Promise<void>,
): Promise<void> {
  const running = runningSupplements.get(userId);
  if (running !== undefined) {
    return running;
  }
  // A new pass can only start after this one settles, because its entry stays
  // in the map until the finally below removes it.
  const started = pass()
    .catch((err: unknown) => {
      console.error("[garmin] supplementary sync failed:", err);
    })
    .finally(() => {
      runningSupplements.delete(userId);
    });
  runningSupplements.set(userId, started);
  return started;
}
