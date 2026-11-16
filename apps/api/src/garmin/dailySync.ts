import type { GarminDailyResponse } from "@killingit/shared";
import { addDays } from "@killingit/shared";
import { errorMessage } from "../lib/errorMessage.js";
import {
  loadGarminDailySyncDates,
  markGarminDailySynced,
  recordGarminDailyMetrics,
} from "../metrics/dailyMetrics.js";
import {
  GarminSidecarError,
  syncGarminDailyMetrics,
  type GarminCredentials,
  type SyncDailyTransport,
} from "./client.js";

/** The same inclusive history window as the sidecar's `SYNC_WINDOW_DAYS`. */
export const GARMIN_DAILY_SYNC_WINDOW_DAYS = 42;
/** Today and yesterday are fetched again because they can still change. */
const GARMIN_DAILY_REFRESH_DAYS = 2;

export interface DailySyncOptions {
  userId: number;
  credentials: GarminCredentials;
  /** The athlete's local calendar date. */
  today: string;
  /** Number of dates in the inclusive window, counting today. */
  windowDays?: number;
  refreshDays?: number;
}

export interface DailySyncDependencies {
  fetchDay?: SyncDailyTransport;
  saveDay?: (userId: number, response: GarminDailyResponse) => Promise<void>;
  loadSyncedDates?: (userId: number, fromDate: string) => Promise<Set<string>>;
  markSynced?: (userId: number, date: string) => Promise<void>;
}

export interface DailySyncResult {
  /** Dates fetched and stored in this pass, newest first. */
  fetched: string[];
  /** True when Garmin rate-limited the pass. */
  rateLimited: boolean;
  /** The date that stopped the pass with a non-rate-limit failure, if any. */
  failedDate: string | null;
}

/**
 * The dates a pass should fetch: today and yesterday first, then every older
 * date without a watermark, walking back to the window floor. A marked date is
 * skipped, so a rate-limited backfill resumes where it stopped.
 */
function planDailySyncDates(input: {
  today: string;
  windowStart: string;
  synced: ReadonlySet<string>;
  refreshDays: number;
}): string[] {
  const dates: string[] = [];
  let date = input.today;
  let index = 0;
  while (date >= input.windowStart) {
    if (index < input.refreshDays || !input.synced.has(date)) {
      dates.push(date);
    }
    date = addDays(date, -1);
    index += 1;
  }
  return dates;
}

/**
 * Syncs daily health and recovery metrics after the activity sync. The pass is
 * fail-open: a rate limit or an upstream outage stops it and leaves the
 * unmarked dates for the next visit without failing the activity feed.
 */
export async function syncGarminDailyHistory(
  options: DailySyncOptions,
  deps: DailySyncDependencies = {},
): Promise<DailySyncResult> {
  const fetchDay = deps.fetchDay ?? syncGarminDailyMetrics;
  const saveDay = deps.saveDay ?? recordGarminDailyMetrics;
  const loadSyncedDates = deps.loadSyncedDates ?? loadGarminDailySyncDates;
  const markSynced = deps.markSynced ?? markGarminDailySynced;

  const windowDays = options.windowDays ?? GARMIN_DAILY_SYNC_WINDOW_DAYS;
  const refreshDays = options.refreshDays ?? GARMIN_DAILY_REFRESH_DAYS;
  // The window is inclusive of today, so its first date is one day short of
  // the full span: 42 days means today plus the 41 days before it.
  const windowStart = addDays(options.today, -(windowDays - 1));

  let synced: Set<string>;
  try {
    synced = await loadSyncedDates(options.userId, windowStart);
  } catch (err) {
    console.error("[garmin] could not read daily sync watermarks:", err);
    synced = new Set();
  }

  const dates = planDailySyncDates({
    today: options.today,
    windowStart,
    synced,
    refreshDays,
  });

  const fetched: string[] = [];
  for (const date of dates) {
    try {
      const response = await fetchDay(options.credentials, date);
      await saveDay(options.userId, response);
      await markSynced(options.userId, date);
      fetched.push(date);
    } catch (err) {
      if (err instanceof GarminSidecarError && err.status === 429) {
        console.warn(
          `[garmin] daily health sync stopped at ${date}: Garmin rate limit`,
        );
        return { fetched, rateLimited: true, failedDate: null };
      }
      const detail = errorMessage(err);
      console.error(`[garmin] daily health sync stopped at ${date}: ${detail}`);
      return { fetched, rateLimited: false, failedDate: date };
    }
  }

  return { fetched, rateLimited: false, failedDate: null };
}
