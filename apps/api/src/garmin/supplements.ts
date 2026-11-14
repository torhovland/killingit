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
