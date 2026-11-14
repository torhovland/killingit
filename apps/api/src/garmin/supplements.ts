import { recordGarminBodyMetrics, recordGarminFtp } from "../metrics/store.js";
import { syncGarminMetrics, type GarminCredentials } from "./client.js";
import { syncGarminDailyHistory } from "./dailySync.js";

/** The loaders and writers behind one supplementary Garmin sync. */
export interface GarminSupplementDependencies {
  /** Injectable for tests; defaults to the sidecar client. */
  syncMetrics?: typeof syncGarminMetrics;
  /** Injectable for tests; defaults to the database-backed writer. */
  saveMetrics?: typeof recordGarminBodyMetrics;
  /** Injectable for tests; defaults to the database-backed writer. */
  saveFtp?: typeof recordGarminFtp;
  /** Injectable for tests; defaults to the daily health backfill. */
  syncDaily?: typeof syncGarminDailyHistory;
}

/**
 * Refreshes the data that complements the activity sync: body composition and
 * Garmin's historic FTP, then the daily health and recovery series. Both passes
 * are fail-open, and a metrics failure never stops the daily health pass, so a
 * supplementary outage cannot hide the synced activities.
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
    // Body composition is supplementary; the activity sync still counts.
    console.error("[garmin] body metrics failure:", err);
  }

  try {
    await syncDaily({ userId, credentials, today });
  } catch (err) {
    // Daily health is supplementary too; never fail the activity sync.
    console.error("[garmin] daily health failure:", err);
  }
}
