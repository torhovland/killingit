import {
  DAILY_HEALTH_METRIC_KEYS,
  type DailyHealthMetricKey,
  type DailyHealthPoint,
  type GarminDailyResponse,
} from "@killingit/shared";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { athleteDailyMetrics, garminDailySync } from "../db/schema.js";

const DAILY_HEALTH_METRIC_SET = new Set<string>(DAILY_HEALTH_METRIC_KEYS);

function isDailyHealthMetric(value: string): value is DailyHealthMetricKey {
  return DAILY_HEALTH_METRIC_SET.has(value);
}

/**
 * Stores one day's Garmin health values, replacing any earlier value for the
 * same metric and date. Unknown keys are ignored so a newer sidecar can add a
 * metric before the API understands it.
 */
export async function recordGarminDailyMetrics(
  userId: number,
  response: GarminDailyResponse,
): Promise<void> {
  const now = new Date();
  const rows = Object.entries(response.metrics).flatMap(([metric, value]) =>
    isDailyHealthMetric(metric) && Number.isFinite(value)
      ? [
          {
            userId,
            metric,
            date: response.date,
            value,
            source: "garmin" as const,
            updatedAt: now,
          },
        ]
      : [],
  );
  if (rows.length === 0) {
    return;
  }
  await db
    .insert(athleteDailyMetrics)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        athleteDailyMetrics.userId,
        athleteDailyMetrics.metric,
        athleteDailyMetrics.date,
      ],
      set: {
        value: sql`excluded.value`,
        updatedAt: now,
      },
    });
}

/**
 * Marks one day as fetched. The watermark is written only after its values are
 * stored, so a failed or rate-limited day is retried on the next pass.
 */
export async function markGarminDailySynced(
  userId: number,
  date: string,
): Promise<void> {
  await db
    .insert(garminDailySync)
    .values({ userId, date, syncedAt: new Date() })
    .onConflictDoUpdate({
      target: [garminDailySync.userId, garminDailySync.date],
      set: { syncedAt: new Date() },
    });
}

/** Loads the dates already fetched for a user at or after `fromDate`. */
export async function loadGarminDailySyncDates(
  userId: number,
  fromDate: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ date: garminDailySync.date })
    .from(garminDailySync)
    .where(
      and(
        eq(garminDailySync.userId, userId),
        gte(garminDailySync.date, fromDate),
      ),
    );
  return new Set(rows.map((row) => row.date));
}

/**
 * Loads every stored daily health value up to `throughDate`, oldest first. The
 * table only holds the synced days, so the chart and latest-reading panel share
 * one read.
 */
export async function loadDailyHealthHistoryForUser(
  userId: number,
  throughDate: string,
): Promise<DailyHealthPoint[]> {
  const rows = await db
    .select({
      metric: athleteDailyMetrics.metric,
      date: athleteDailyMetrics.date,
      value: athleteDailyMetrics.value,
    })
    .from(athleteDailyMetrics)
    .where(
      and(
        eq(athleteDailyMetrics.userId, userId),
        lte(athleteDailyMetrics.date, throughDate),
      ),
    )
    .orderBy(asc(athleteDailyMetrics.date));

  return rows.flatMap((row) =>
    isDailyHealthMetric(row.metric)
      ? [{ metric: row.metric, date: row.date, value: row.value }]
      : [],
  );
}

/** Loads the stored daily health series, oldest first. */
export async function loadDailyHealthForUser(
  userId: number,
  fromDate: string,
  throughDate: string,
): Promise<DailyHealthPoint[]> {
  const rows = await db
    .select({
      metric: athleteDailyMetrics.metric,
      date: athleteDailyMetrics.date,
      value: athleteDailyMetrics.value,
    })
    .from(athleteDailyMetrics)
    .where(
      and(
        eq(athleteDailyMetrics.userId, userId),
        gte(athleteDailyMetrics.date, fromDate),
        lte(athleteDailyMetrics.date, throughDate),
      ),
    )
    .orderBy(asc(athleteDailyMetrics.date));

  return rows.flatMap((row) =>
    isDailyHealthMetric(row.metric)
      ? [{ metric: row.metric, date: row.date, value: row.value }]
      : [],
  );
}
