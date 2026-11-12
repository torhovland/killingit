import {
  activitySport,
  type AthleteMetric,
  type AthleteMetricStatement,
  type AthleteThreshold,
  type AthleteThresholdStatement,
  type BodyMetricEstimate,
  type GarminBodyMetricSample,
  type GarminFtpSample,
  type MetricPoint,
  type MetricSource,
  type ThresholdSummary,
} from "@killingit/shared";
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  athleteMetrics,
  athleteThresholds,
  type NewAthleteMetricRow,
  type NewAthleteThresholdRow,
} from "../db/schema.js";
import type { BodyMetricHistory } from "../llm/profileContext.js";
import {
  buildThresholdTimelines,
  currentThresholdSummaries,
  FTP_THRESHOLD,
  type ThresholdTimeline,
} from "../training/thresholds.js";

/** The shared connection or one transaction on it, so a rewrite can be atomic. */
type DbExecutor =
  typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Loads one body metric's stored points, oldest first. */
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
 * Loads every stored threshold point, oldest first. The filter is optional so
 * callers can load one sport/measure or the full set.
 */
export async function loadThresholdPoints(
  userId: number,
  filter?: { sport?: string; measure?: string },
): Promise<AthleteThreshold[]> {
  const conditions = [eq(athleteThresholds.userId, userId)];
  if (filter?.sport !== undefined) {
    conditions.push(eq(athleteThresholds.sport, filter.sport));
  }
  if (filter?.measure !== undefined) {
    conditions.push(eq(athleteThresholds.measure, filter.measure));
  }
  const rows = await db
    .select()
    .from(athleteThresholds)
    .where(and(...conditions))
    .orderBy(asc(athleteThresholds.date));
  return rows.map(toAthleteThreshold);
}

/**
 * Stores a coach threshold estimate and discards older coach estimates that
 * fall after it. Athlete measurements are never removed. The same day is left
 * untouched when the athlete or Garmin already supplied a value there. The
 * delete and the insert are one transaction, so a failed write keeps the
 * estimates it was about to replace.
 */
export async function recordCoachThreshold(input: {
  userId: number;
  sport: string;
  measure: string;
  label: string;
  unit: string;
  kind: AthleteThresholdStatement["kind"];
  date: string;
  value: number;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(athleteThresholds)
      .where(
        and(
          eq(athleteThresholds.userId, input.userId),
          eq(athleteThresholds.sport, input.sport),
          eq(athleteThresholds.measure, input.measure),
          eq(athleteThresholds.source, "coach"),
          gt(athleteThresholds.date, input.date),
        ),
      );
    await recordThreshold(tx, {
      userId: input.userId,
      date: input.date,
      sport: input.sport,
      measure: input.measure,
      label: input.label,
      unit: input.unit,
      kind: input.kind,
      value: input.value,
      source: "coach",
      keepSources: ["user", "garmin"],
    });
  });
}

/** Stores a coach cycling FTP estimate, the legacy power-specific entry point. */
export async function recordCoachFtp(input: {
  userId: number;
  date: string;
  watts: number;
}): Promise<void> {
  await recordCoachThreshold({
    userId: input.userId,
    ...FTP_THRESHOLD,
    date: input.date,
    value: input.watts,
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
 * Stores the historic cycling FTP Garmin reports as a cycling power threshold.
 * They are measurements, so they replace coach estimates for the same day and
 * are never deleted by a newer coach estimate.
 */
export async function recordGarminFtp(
  userId: number,
  samples: readonly GarminFtpSample[],
): Promise<void> {
  for (const sample of samples) {
    await recordThreshold(db, {
      userId,
      ...FTP_THRESHOLD,
      date: sample.date,
      value: sample.watts,
      source: "garmin",
      keepSources: ["user"],
    });
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
 * Whether an incoming measurement may replace the value already stored for a
 * day. A source listed in `keepSources` is a stronger measurement and wins, so
 * an athlete-stated value is never overwritten by a Garmin sync or a coach
 * estimate.
 */
export function shouldRecordSource(
  current: MetricSource | undefined,
  keepSources: readonly MetricSource[],
): boolean {
  return current === undefined || !keepSources.includes(current);
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
  if (!shouldRecordSource(current?.source, input.keepSources)) {
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

/** Writes one threshold value unless a stronger source holds that day. */
async function recordThreshold(
  executor: DbExecutor,
  input: {
    userId: number;
    date: string;
    sport: string;
    measure: string;
    label: string;
    unit: string;
    kind: AthleteThresholdStatement["kind"];
    value: number;
    source: MetricSource;
    keepSources: readonly MetricSource[];
  },
): Promise<void> {
  const sport = activitySport(input.sport);
  const measure = normalizeMeasure(input.measure);
  const existing = await executor
    .select({ source: athleteThresholds.source })
    .from(athleteThresholds)
    .where(
      and(
        eq(athleteThresholds.userId, input.userId),
        eq(athleteThresholds.sport, sport),
        eq(athleteThresholds.measure, measure),
        eq(athleteThresholds.date, input.date),
      ),
    )
    .limit(1);
  const current = existing[0];
  if (!shouldRecordSource(current?.source, input.keepSources)) {
    return;
  }
  await executor
    .insert(athleteThresholds)
    .values({
      userId: input.userId,
      sport,
      measure,
      label: input.label,
      unit: input.unit,
      kind: input.kind,
      source: input.source,
      date: input.date,
      value: input.value,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        athleteThresholds.userId,
        athleteThresholds.sport,
        athleteThresholds.measure,
        athleteThresholds.date,
      ],
      set: {
        label: input.label,
        unit: input.unit,
        kind: input.kind,
        source: input.source,
        value: input.value,
        updatedAt: new Date(),
      },
    });
}

/** Canonical lower-snake key so "FTP" and "ftp" are the same measure. */
function normalizeMeasure(measure: string): string {
  const key = measure
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key === "" ? "threshold" : key;
}

/**
 * Stores the measurements the coach read from the athlete's own words. A
 * successful read reports everything the athlete has ever stated, so it
 * replaces the `user` points of every threshold measure (and body metric) it
 * reported: a value the athlete later edits out of a comment disappears
 * instead of lingering. Garmin measurements and coach estimates are left
 * alone, and a measure the read says nothing about is untouched.
 *
 * The delete and the inserts share one transaction, so a failed write or a
 * crash cannot leave the athlete's stated values empty, and no reader sees the
 * series between the two. Each table is written with one batched insert; when
 * the read reports the same measure twice for a day the later statement wins,
 * so the batch never names one conflict target twice.
 */
export async function recordAthleteMetricStatements(
  userId: number,
  statements: readonly AthleteMetricStatement[],
  throughDate: string,
): Promise<void> {
  const current = statements.filter((entry) => entry.date <= throughDate);
  const reportedMetrics = new Set<AthleteMetric>();
  if (current.some((entry) => entry.weightKg !== null)) {
    reportedMetrics.add("weight");
  }
  if (current.some((entry) => entry.bodyFatPercent !== null)) {
    reportedMetrics.add("body_fat");
  }
  const reportedThresholds = new Map<
    string,
    Pick<AthleteThreshold, "sport" | "measure">
  >();
  for (const statement of current) {
    for (const threshold of statement.thresholds) {
      const sport = activitySport(threshold.sport ?? "other");
      const measure = normalizeMeasure(threshold.measure);
      reportedThresholds.set(`${sport}\u0000${measure}`, {
        sport,
        measure,
      });
    }
  }

  const now = new Date();
  const metricRows = new Map<string, NewAthleteMetricRow>();
  const thresholdRows = new Map<string, NewAthleteThresholdRow>();
  for (const statement of current) {
    if (statement.weightKg !== null) {
      metricRows.set(`weight\u0000${statement.date}`, {
        userId,
        metric: "weight",
        source: "user",
        date: statement.date,
        value: statement.weightKg,
        updatedAt: now,
      });
    }
    if (statement.bodyFatPercent !== null) {
      metricRows.set(`body_fat\u0000${statement.date}`, {
        userId,
        metric: "body_fat",
        source: "user",
        date: statement.date,
        value: statement.bodyFatPercent,
        updatedAt: now,
      });
    }
    for (const threshold of statement.thresholds) {
      const sport = activitySport(threshold.sport ?? "other");
      const measure = normalizeMeasure(threshold.measure);
      thresholdRows.set(`${sport}\u0000${measure}\u0000${statement.date}`, {
        userId,
        source: "user",
        sport,
        measure,
        label: threshold.label,
        unit: threshold.unit,
        kind: threshold.kind,
        date: statement.date,
        value: threshold.value,
        updatedAt: now,
      });
    }
  }

  await db.transaction(async (tx) => {
    if (reportedMetrics.size > 0) {
      await tx
        .delete(athleteMetrics)
        .where(
          and(
            eq(athleteMetrics.userId, userId),
            inArray(athleteMetrics.metric, [...reportedMetrics]),
            eq(athleteMetrics.source, "user"),
          ),
        );
    }
    const thresholdConditions = [...reportedThresholds.values()].map(
      (threshold) =>
        and(
          eq(athleteThresholds.sport, threshold.sport),
          eq(athleteThresholds.measure, threshold.measure),
        ),
    );
    if (thresholdConditions.length > 0) {
      await tx
        .delete(athleteThresholds)
        .where(
          and(
            eq(athleteThresholds.userId, userId),
            eq(athleteThresholds.source, "user"),
            or(...thresholdConditions),
          ),
        );
    }

    if (metricRows.size > 0) {
      await tx
        .insert(athleteMetrics)
        .values([...metricRows.values()])
        .onConflictDoUpdate({
          target: [
            athleteMetrics.userId,
            athleteMetrics.metric,
            athleteMetrics.date,
          ],
          set: {
            source: "user",
            value: sql`excluded.value`,
            updatedAt: now,
          },
        });
    }
    if (thresholdRows.size > 0) {
      await tx
        .insert(athleteThresholds)
        .values([...thresholdRows.values()])
        .onConflictDoUpdate({
          target: [
            athleteThresholds.userId,
            athleteThresholds.sport,
            athleteThresholds.measure,
            athleteThresholds.date,
          ],
          set: {
            label: sql`excluded.label`,
            unit: sql`excluded.unit`,
            kind: sql`excluded.kind`,
            source: "user",
            value: sql`excluded.value`,
            updatedAt: now,
          },
        });
    }
  });
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

/** Loads every threshold point and builds one timeline per measure. */
export async function loadThresholdHistoryForUser(
  userId: number,
  throughDate: string,
): Promise<{
  points: AthleteThreshold[];
  timelines: ThresholdTimeline[];
  summaries: ThresholdSummary[];
}> {
  const points = await loadThresholdPoints(userId);
  return {
    points,
    timelines: buildThresholdTimelines(points, throughDate),
    summaries: currentThresholdSummaries(points, throughDate),
  };
}

function toAthleteThreshold(row: {
  sport: string;
  measure: string;
  label: string;
  unit: string;
  kind: AthleteThreshold["kind"];
  source: MetricSource;
  date: string;
  value: number;
}): AthleteThreshold {
  return {
    sport: row.sport,
    measure: row.measure,
    label: row.label,
    unit: row.unit,
    kind: row.kind,
    source: row.source,
    date: row.date,
    value: row.value,
  };
}
