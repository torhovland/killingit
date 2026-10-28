import type {
  AthleteMetric,
  GarminBodyMetricSample,
  GarminFtpSample,
  MetricPoint,
  MetricSource,
} from "@killingit/shared";
import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "../db/index.js";
import { athleteMetrics } from "../db/schema.js";
import {
  extractFtpAnchors,
  buildFtpTimelineFromPoints,
  type FtpInput,
  type FtpTimeline,
} from "../training/ftp.js";

/** Loads one metric's stored points, oldest first. */
export async function loadMetricPoints(
  userId: number,
  metric: AthleteMetric,
): Promise<MetricPoint[]> {
  const rows = await db
    .select()
    .from(athleteMetrics)
    .where(
      and(eq(athleteMetrics.userId, userId), eq(athleteMetrics.metric, metric)),
    )
    .orderBy(asc(athleteMetrics.date));
  return rows.map((row) => ({
    date: row.date,
    value: row.value,
    source: row.source,
  }));
}

/**
 * Stores an athlete-stated measurement. A user value always wins over a coach
 * estimate or a Garmin value for the same day.
 */
export async function recordUserMetric(input: {
  userId: number;
  metric: AthleteMetric;
  date: string;
  value: number;
}): Promise<void> {
  await db
    .insert(athleteMetrics)
    .values({
      userId: input.userId,
      metric: input.metric,
      source: "user",
      date: input.date,
      value: input.value,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        athleteMetrics.userId,
        athleteMetrics.metric,
        athleteMetrics.date,
      ],
      set: { source: "user", value: input.value, updatedAt: new Date() },
    });
}

/**
 * Stores a coach FTP estimate and discards older coach estimates that fall
 * after it. Athlete measurements are never removed. The same day is left
 * untouched when the athlete or Garmin already supplied a value there.
 */
export async function recordCoachFtp(input: {
  userId: number;
  date: string;
  watts: number;
}): Promise<void> {
  await db
    .delete(athleteMetrics)
    .where(
      and(
        eq(athleteMetrics.userId, input.userId),
        eq(athleteMetrics.metric, "ftp"),
        eq(athleteMetrics.source, "coach"),
        gt(athleteMetrics.date, input.date),
      ),
    );

  const existing = await db
    .select({ source: athleteMetrics.source })
    .from(athleteMetrics)
    .where(
      and(
        eq(athleteMetrics.userId, input.userId),
        eq(athleteMetrics.metric, "ftp"),
        eq(athleteMetrics.date, input.date),
      ),
    )
    .limit(1);
  const current = existing[0];
  if (current !== undefined && current.source !== "coach") {
    return;
  }

  await db
    .insert(athleteMetrics)
    .values({
      userId: input.userId,
      metric: "ftp",
      source: "coach",
      date: input.date,
      value: input.watts,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        athleteMetrics.userId,
        athleteMetrics.metric,
        athleteMetrics.date,
      ],
      set: { source: "coach", value: input.watts, updatedAt: new Date() },
    });
}

/** Stores every FTP estimate the coach returned for a plan. */
export async function recordPlanFtpEstimates(
  userId: number,
  estimates: readonly { date: string; watts: number }[],
): Promise<void> {
  const sorted = [...estimates].sort((a, b) => a.date.localeCompare(b.date));
  for (const estimate of sorted) {
    await recordCoachFtp({
      userId,
      date: estimate.date,
      watts: estimate.watts,
    });
  }
}

/**
 * Stores body-composition samples synced from Garmin. A measurement the athlete
 * entered by hand wins; anything else is replaced by the scale's value.
 */
export async function recordGarminBodyMetrics(
  userId: number,
  samples: readonly GarminBodyMetricSample[],
): Promise<void> {
  for (const sample of samples) {
    if (sample.weightKg !== undefined) {
      await recordGarminMetric(userId, "weight", sample.date, sample.weightKg);
    }
    if (sample.bodyFatPercent !== undefined) {
      await recordGarminMetric(
        userId,
        "body_fat",
        sample.date,
        sample.bodyFatPercent,
      );
    }
  }
}

/**
 * Stores the historic cycling FTP Garmin reports. These are measurements, so
 * they replace coach estimates for the same day and are never deleted by a
 * newer coach estimate.
 */
export async function recordGarminFtp(
  userId: number,
  samples: readonly GarminFtpSample[],
): Promise<void> {
  for (const sample of samples) {
    await recordGarminMetric(userId, "ftp", sample.date, sample.watts);
  }
}

async function recordGarminMetric(
  userId: number,
  metric: AthleteMetric,
  date: string,
  value: number,
): Promise<void> {
  const existing = await db
    .select({ source: athleteMetrics.source })
    .from(athleteMetrics)
    .where(
      and(
        eq(athleteMetrics.userId, userId),
        eq(athleteMetrics.metric, metric),
        eq(athleteMetrics.date, date),
      ),
    )
    .limit(1);
  if (existing[0]?.source === "user") {
    return;
  }
  await db
    .insert(athleteMetrics)
    .values({
      userId,
      metric,
      source: "garmin" satisfies MetricSource,
      date,
      value,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        athleteMetrics.userId,
        athleteMetrics.metric,
        athleteMetrics.date,
      ],
      set: { source: "garmin", value, updatedAt: new Date() },
    });
}

/**
 * Seeds the FTP time series from existing free-text profile answers and dated
 * athlete inputs. This keeps accounts that stated an FTP before the time series
 * existed working, and lets later edits add a new measurement.
 */
export async function syncFtpFromInputs(
  userId: number,
  input: FtpInput,
  undatedProfileDate = new Date().toISOString().slice(0, 10),
): Promise<void> {
  for (const anchor of extractFtpAnchors(input)) {
    const date =
      anchor.at > 0
        ? new Date(anchor.at).toISOString().slice(0, 10)
        : undatedProfileDate;
    await recordUserMetric({
      userId,
      metric: "ftp",
      date,
      value: anchor.watts,
    });
  }
}

/**
 * Seeds the FTP series from the athlete's free-text inputs, then returns the
 * stored points and a timeline that ignores estimates dated after `throughDate`.
 */
export async function loadFtpHistoryForUser(
  userId: number,
  input: FtpInput,
  throughDate: string,
): Promise<{ points: MetricPoint[]; timeline: FtpTimeline }> {
  await syncFtpFromInputs(userId, input, throughDate);
  const points = await loadMetricPoints(userId, "ftp");
  return {
    points,
    timeline: buildFtpTimelineFromPoints(points, throughDate),
  };
}
