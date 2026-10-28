import type {
  AthleteMetric,
  AthleteMetricStatement,
  BodyMetricEstimate,
  GarminBodyMetricSample,
  GarminFtpSample,
  MetricPoint,
  MetricSource,
} from "@killingit/shared";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { athleteMetrics } from "../db/schema.js";
import type { BodyMetricHistory } from "../llm/planContext.js";
import {
  buildFtpTimelineFromPoints,
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
  await recordMeasuredMetric({
    userId,
    metric,
    date,
    value,
    source: "garmin",
    keepSources: ["user"],
  });
}

/**
 * Stores the body-composition values the coach found in the athlete's input.
 * The point is dated by the statement it came from, so a weight mentioned in a
 * comment lands on that activity's day. Points after `throughDate` are ignored:
 * a future projection is not a measurement.
 */
export async function recordCoachBodyMetrics(
  userId: number,
  points: readonly BodyMetricEstimate[],
  throughDate?: string,
): Promise<void> {
  for (const point of points) {
    if (throughDate !== undefined && point.date > throughDate) {
      continue;
    }
    if (point.weightKg !== null) {
      await recordMeasuredMetric({
        userId,
        metric: "weight",
        date: point.date,
        value: point.weightKg,
        source: "coach",
        keepSources: ["user", "garmin"],
      });
    }
    if (point.bodyFatPercent !== null) {
      await recordMeasuredMetric({
        userId,
        metric: "body_fat",
        date: point.date,
        value: point.bodyFatPercent,
        source: "coach",
        keepSources: ["user", "garmin"],
      });
    }
  }
}

/**
 * Writes one metric value unless a stronger source already holds that day. A
 * stronger value (`keepSources`) is never replaced by this one.
 */
async function recordMeasuredMetric(input: {
  userId: number;
  metric: AthleteMetric;
  date: string;
  value: number;
  source: MetricSource;
  keepSources: readonly MetricSource[];
}): Promise<void> {
  const existing = await db
    .select({ source: athleteMetrics.source })
    .from(athleteMetrics)
    .where(
      and(
        eq(athleteMetrics.userId, input.userId),
        eq(athleteMetrics.metric, input.metric),
        eq(athleteMetrics.date, input.date),
      ),
    )
    .limit(1);
  const current = existing[0];
  if (current !== undefined && input.keepSources.includes(current.source)) {
    return;
  }
  await db
    .insert(athleteMetrics)
    .values({
      userId: input.userId,
      metric: input.metric,
      source: input.source,
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
      set: {
        source: input.source,
        value: input.value,
        updatedAt: new Date(),
      },
    });
}

/**
 * Stores the measurements the coach read from the athlete's own words. The
 * coach does the reading (it understands "around 240 W", "74 kg", or "down to
 * 12 %"), so this only persists what it reported. A statement dated after today
 * is ignored, and a value the coach did not find is skipped.
 *
 * A successful read reports everything the athlete has ever stated, so it
 * replaces the `user` points of every metric it reported: a value the athlete
 * later edits out of a comment disappears instead of lingering. Garmin
 * measurements and coach estimates are left alone, and a metric the read says
 * nothing about is untouched.
 */
export async function recordAthleteMetricStatements(
  userId: number,
  statements: readonly AthleteMetricStatement[],
  throughDate: string,
): Promise<void> {
  const current = statements.filter((entry) => entry.date <= throughDate);
  const reported = new Set<AthleteMetric>();
  if (current.some((entry) => entry.ftpWatts !== null)) {
    reported.add("ftp");
  }
  if (current.some((entry) => entry.weightKg !== null)) {
    reported.add("weight");
  }
  if (current.some((entry) => entry.bodyFatPercent !== null)) {
    reported.add("body_fat");
  }
  if (reported.size === 0) {
    return;
  }

  await db
    .delete(athleteMetrics)
    .where(
      and(
        eq(athleteMetrics.userId, userId),
        inArray(athleteMetrics.metric, [...reported]),
        eq(athleteMetrics.source, "user"),
      ),
    );

  for (const statement of current) {
    if (statement.ftpWatts !== null) {
      await recordUserMetric({
        userId,
        metric: "ftp",
        date: statement.date,
        value: statement.ftpWatts,
      });
    }
    if (statement.weightKg !== null) {
      await recordUserMetric({
        userId,
        metric: "weight",
        date: statement.date,
        value: statement.weightKg,
      });
    }
    if (statement.bodyFatPercent !== null) {
      await recordUserMetric({
        userId,
        metric: "body_fat",
        date: statement.date,
        value: statement.bodyFatPercent,
      });
    }
  }
}

/** Loads the stored body weight and body-fat series for a prompt. */
export async function loadBodyHistoryForUser(
  userId: number,
): Promise<BodyMetricHistory> {
  const [weight, bodyFat] = await Promise.all([
    loadMetricPoints(userId, "weight"),
    loadMetricPoints(userId, "body_fat"),
  ]);
  return { weight, bodyFat };
}

/**
 * Returns the stored FTP points and a timeline that ignores estimates dated
 * after `throughDate`. The athlete's stated FTP is read by the coach and stored
 * separately, so this no longer scans free text.
 */
export async function loadFtpHistoryForUser(
  userId: number,
  throughDate: string,
): Promise<{ points: MetricPoint[]; timeline: FtpTimeline }> {
  const points = await loadMetricPoints(userId, "ftp");
  return {
    points,
    timeline: buildFtpTimelineFromPoints(points, throughDate),
  };
}
