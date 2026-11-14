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
import { and, asc, eq, gt, inArray, notInArray, or, sql } from "drizzle-orm";
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

/** One dated body-metric value in a batched write. */
type MetricWrite = {
  metric: AthleteMetric;
  date: string;
  value: number;
};

/** One dated threshold value in a batched write. */
type ThresholdWrite = {
  sport: string;
  measure: string;
  label: string;
  unit: string;
  kind: AthleteThresholdStatement["kind"];
  date: string;
  value: number;
};

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
 * untouched when the athlete or Garmin already supplied a value there.
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
  const { userId, ...estimate } = input;
  await recordCoachThresholds(userId, [estimate]);
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
  const writes = [...estimates]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((estimate) => ({
      ...FTP_THRESHOLD,
      date: estimate.date,
      value: estimate.watts,
    }));
  await recordCoachThresholds(userId, writes);
}

/**
 * Stores a batch of coach threshold estimates and discards older coach
 * estimates that fall after the earliest estimate of the batch, which is what
 * applying the batch oldest first removes. The delete and the batched insert
 * are one transaction, so a failed write keeps the estimates it was about to
 * replace and no reader sees the series between the two.
 */
async function recordCoachThresholds(
  userId: number,
  writes: readonly ThresholdWrite[],
): Promise<void> {
  if (writes.length === 0) {
    return;
  }
  const earliest = new Map<
    string,
    Pick<AthleteThreshold, "sport" | "measure" | "date">
  >();
  for (const write of writes) {
    const sport = activitySport(write.sport);
    const measure = normalizeMeasure(write.measure);
    const key = `${sport}\u0000${measure}`;
    const current = earliest.get(key);
    if (current === undefined || write.date < current.date) {
      earliest.set(key, { sport, measure, date: write.date });
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(athleteThresholds)
      .where(
        and(
          eq(athleteThresholds.userId, userId),
          eq(athleteThresholds.source, "coach"),
          or(
            ...[...earliest.values()].map((estimate) =>
              and(
                eq(athleteThresholds.sport, estimate.sport),
                eq(athleteThresholds.measure, estimate.measure),
                gt(athleteThresholds.date, estimate.date),
              ),
            ),
          ),
        ),
      );
    await recordThresholdBatch(tx, userId, "coach", ["user", "garmin"], writes);
  });
}

/**
 * Stores body-composition samples synced from Garmin. A measurement the athlete
 * entered by hand wins; anything else is replaced by the scale's value.
 */
export async function recordGarminBodyMetrics(
  userId: number,
  samples: readonly GarminBodyMetricSample[],
): Promise<void> {
  const writes: MetricWrite[] = [];
  for (const sample of samples) {
    if (sample.weightKg !== undefined) {
      writes.push({
        metric: "weight",
        date: sample.date,
        value: sample.weightKg,
      });
    }
    if (sample.bodyFatPercent !== undefined) {
      writes.push({
        metric: "body_fat",
        date: sample.date,
        value: sample.bodyFatPercent,
      });
    }
  }
  await recordMetricBatch(db, userId, "garmin", ["user"], writes);
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
  await recordThresholdBatch(
    db,
    userId,
    "garmin",
    ["user"],
    samples.map((sample) => ({
      ...FTP_THRESHOLD,
      date: sample.date,
      value: sample.watts,
    })),
  );
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
  const writes: MetricWrite[] = [];
  for (const point of points) {
    if (throughDate !== undefined && point.date > throughDate) {
      continue;
    }
    if (point.weightKg !== null) {
      writes.push({
        metric: "weight",
        date: point.date,
        value: point.weightKg,
      });
    }
    if (point.bodyFatPercent !== null) {
      writes.push({
        metric: "body_fat",
        date: point.date,
        value: point.bodyFatPercent,
      });
    }
  }
  await recordMetricBatch(db, userId, "coach", ["user", "garmin"], writes);
}

/**
 * Writes a batch of body-metric values in one statement. The conflict branch
 * updates only a day a stronger source (`keepSources`) does not already hold,
 * so the database decides precedence and no read that another writer can
 * invalidate sits before the write. A day the batch names twice keeps its last
 * value, which is the one a sequential write would leave.
 */
async function recordMetricBatch(
  executor: DbExecutor,
  userId: number,
  source: MetricSource,
  keepSources: readonly MetricSource[],
  writes: readonly MetricWrite[],
): Promise<void> {
  const now = new Date();
  const rows = new Map<string, NewAthleteMetricRow>();
  for (const write of writes) {
    rows.set(`${write.metric}\u0000${write.date}`, {
      userId,
      metric: write.metric,
      source,
      date: write.date,
      value: write.value,
      updatedAt: now,
    });
  }
  if (rows.size === 0) {
    return;
  }
  await executor
    .insert(athleteMetrics)
    .values([...rows.values()])
    .onConflictDoUpdate({
      target: [
        athleteMetrics.userId,
        athleteMetrics.metric,
        athleteMetrics.date,
      ],
      set: {
        source,
        value: sql`excluded.value`,
        updatedAt: now,
      },
      where: notInArray(athleteMetrics.source, [...keepSources]),
    });
}

/**
 * Writes a batch of threshold values in one statement under the same
 * precedence rule as {@link recordMetricBatch}: a sport measure and day a
 * stronger source holds keeps its stored value.
 */
async function recordThresholdBatch(
  executor: DbExecutor,
  userId: number,
  source: MetricSource,
  keepSources: readonly MetricSource[],
  writes: readonly ThresholdWrite[],
): Promise<void> {
  const now = new Date();
  const rows = new Map<string, NewAthleteThresholdRow>();
  for (const write of writes) {
    const sport = activitySport(write.sport);
    const measure = normalizeMeasure(write.measure);
    rows.set(`${sport}\u0000${measure}\u0000${write.date}`, {
      userId,
      sport,
      measure,
      label: write.label,
      unit: write.unit,
      kind: write.kind,
      source,
      date: write.date,
      value: write.value,
      updatedAt: now,
    });
  }
  if (rows.size === 0) {
    return;
  }
  await executor
    .insert(athleteThresholds)
    .values([...rows.values()])
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
        source,
        value: sql`excluded.value`,
        updatedAt: now,
      },
      where: notInArray(athleteThresholds.source, [...keepSources]),
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

  const metricWrites: MetricWrite[] = [];
  const thresholdWrites: ThresholdWrite[] = [];
  for (const statement of current) {
    if (statement.weightKg !== null) {
      metricWrites.push({
        metric: "weight",
        date: statement.date,
        value: statement.weightKg,
      });
    }
    if (statement.bodyFatPercent !== null) {
      metricWrites.push({
        metric: "body_fat",
        date: statement.date,
        value: statement.bodyFatPercent,
      });
    }
    for (const threshold of statement.thresholds) {
      thresholdWrites.push({
        sport: threshold.sport ?? "other",
        measure: threshold.measure,
        label: threshold.label,
        unit: threshold.unit,
        kind: threshold.kind,
        date: statement.date,
        value: threshold.value,
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

    // The athlete's own words always win, so nothing is kept from the stored row.
    await recordMetricBatch(tx, userId, "user", [], metricWrites);
    await recordThresholdBatch(tx, userId, "user", [], thresholdWrites);
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
