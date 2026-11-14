import {
  recordedPowerSummary,
  type Activity,
  type ActivityLap,
  type ActivitySample,
  type ActivitySummary,
  type AnalyzedActivitiesResponse,
  type AnalyzedActivity,
  type RoutePoint,
  type StrengthSet,
} from "@killingit/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { activities, type NewActivityRow } from "../db/schema.js";
import { downsample } from "../lib/downsample.js";
import { loadAnalyses, type StoredAnalysis } from "../llm/analysisStore.js";
import {
  loadActivityFeedback,
  toCoachAnalysis,
  type ActivityFeedback,
} from "../plans/replies.js";
import { routeFromSamples } from "./route.js";

/**
 * How many of the newest activities one coach analysis or prompt reviews. The
 * store keeps every activity, so this only bounds the model's context.
 */
export const MAX_ANALYZED_ACTIVITIES = 20;

/** Enough samples for a readable preview without storing the full timeseries. */
const MAX_PREVIEW_SAMPLES = 120;

/** Which on-demand columns a caller loads with an activity row. */
export type ActivityPreviewScope = "none" | "route" | "samples";

/** The summary plus the bounded preview and route an activity page shows. */
export type ActivityPreview = ActivitySummary & {
  sampleCount: number;
  samples: ActivitySample[];
  route?: RoutePoint[];
};

/** The scalar columns every activity read loads. */
const summaryColumns = {
  activityId: activities.activityId,
  name: activities.name,
  type: activities.type,
  startDate: activities.startDate,
  distance: activities.distance,
  movingTime: activities.movingTime,
  elapsedTime: activities.elapsedTime,
  totalElevationGain: activities.totalElevationGain,
  averagePower: activities.averagePower,
  normalizedPower: activities.normalizedPower,
  averageHeartRate: activities.averageHeartRate,
  averageSpeed: activities.averageSpeed,
  maxSpeed: activities.maxSpeed,
  sampleCount: activities.sampleCount,
  strengthSets: activities.strengthSets,
  laps: activities.laps,
};

/** One selected row before it is mapped to the shared activity shape. */
interface ActivityRowData {
  activityId: number;
  name: string;
  type: string;
  startDate: Date;
  distance: number;
  movingTime: number;
  elapsedTime: number;
  totalElevationGain: number;
  averagePower: number | null;
  normalizedPower: number | null;
  averageHeartRate: number | null;
  averageSpeed: number | null;
  maxSpeed: number | null;
  sampleCount: number;
  strengthSets: StrengthSet[] | null;
  laps: ActivityLap[] | null;
  samples?: ActivitySample[];
  route?: RoutePoint[] | null;
}

/**
 * Reduces a full synced activity to what the app stores: the summary, a bounded
 * sample preview and a bounded GPS route.
 */
export function summarizeActivity(activity: Activity): ActivityPreview {
  const { samples, ...summary } = activity;
  const route = routeFromSamples(samples);
  const power = recordedPowerSummary(samples);
  return {
    ...summary,
    sampleCount: samples.length,
    samples: downsample(samples, MAX_PREVIEW_SAMPLES),
    ...(power.averagePower !== null
      ? { averagePower: power.averagePower }
      : {}),
    ...(power.normalizedPower !== null
      ? { normalizedPower: power.normalizedPower }
      : {}),
    ...(route.length >= 2 ? { route } : {}),
  };
}

/** Loads the account's stored activities, newest first, with the chosen preview columns. */
export async function loadStoredActivities(
  userId: number,
  scope: ActivityPreviewScope = "none",
): Promise<AnalyzedActivity[]> {
  const rows =
    scope === "samples"
      ? await db
          .select({
            ...summaryColumns,
            samples: activities.samples,
            route: activities.route,
          })
          .from(activities)
          .where(eq(activities.userId, userId))
          .orderBy(desc(activities.startDate), desc(activities.activityId))
      : scope === "route"
        ? await db
            .select({ ...summaryColumns, route: activities.route })
            .from(activities)
            .where(eq(activities.userId, userId))
            .orderBy(desc(activities.startDate), desc(activities.activityId))
        : await db
            .select(summaryColumns)
            .from(activities)
            .where(eq(activities.userId, userId))
            .orderBy(desc(activities.startDate), desc(activities.activityId));

  return rows.map(toStoredActivity);
}

/**
 * Loads the stored activities with the coach's analyses and the athlete's
 * feedback attached, ready to serve as the activity feed.
 */
export async function loadStoredActivityFeed(
  userId: number,
  scope: ActivityPreviewScope = "none",
): Promise<AnalyzedActivitiesResponse> {
  const stored = await loadStoredActivities(userId, scope);
  if (stored.length === 0) {
    return { model: null, activities: [] };
  }

  const activityIds = stored.map((activity) => activity.id);
  const [feedback, analyses, programAnalyses] = await Promise.all([
    loadActivityFeedback(userId, activityIds),
    loadAnalyses(userId, activityIds),
    loadAnalyses(userId, activityIds, "program"),
  ]);

  return {
    model: null,
    activities: stored.map((activity) =>
      withCoachWork(
        activity,
        feedback.get(String(activity.id)),
        analyses.get(activity.id),
        programAnalyses.get(activity.id),
      ),
    ),
  };
}

/** The inserted row's value for a column name, for the upsert's update set. */
function excluded(column: string): ReturnType<typeof sql.raw> {
  return sql.raw(`excluded."${column}"`);
}

/**
 * Stores the freshly synced activities and removes the ones the athlete
 * deleted. Only the sync window is written, so a sync no longer rewrites every
 * activity ever recorded.
 */
export async function saveStoredActivities(
  userId: number,
  synced: readonly Activity[],
  deletedIds: ReadonlySet<string> = new Set(),
): Promise<void> {
  const now = new Date();
  const rows = synced
    .filter((activity) => !deletedIds.has(String(activity.id)))
    .map((activity) => toActivityRow(userId, activity, now));
  const deletedActivityIds = [...deletedIds]
    .map(Number)
    .filter((id) => !Number.isNaN(id));

  await db.transaction(async (tx) => {
    if (rows.length > 0) {
      await tx
        .insert(activities)
        .values(rows)
        .onConflictDoUpdate({
          target: [activities.userId, activities.activityId],
          set: {
            name: excluded("name"),
            type: excluded("type"),
            startDate: excluded("start_date"),
            distance: excluded("distance"),
            movingTime: excluded("moving_time"),
            elapsedTime: excluded("elapsed_time"),
            totalElevationGain: excluded("total_elevation_gain"),
            averagePower: excluded("average_power"),
            normalizedPower: excluded("normalized_power"),
            averageHeartRate: excluded("average_heart_rate"),
            averageSpeed: excluded("average_speed"),
            maxSpeed: excluded("max_speed"),
            sampleCount: excluded("sample_count"),
            strengthSets: excluded("strength_sets"),
            laps: excluded("laps"),
            samples: excluded("samples"),
            route: excluded("route"),
            updatedAt: now,
          },
        });
    }
    if (deletedActivityIds.length > 0) {
      await tx
        .delete(activities)
        .where(
          and(
            eq(activities.userId, userId),
            inArray(activities.activityId, deletedActivityIds),
          ),
        );
    }
  });
}

/** Applies the coach's analyses and the athlete's feedback to one activity. */
function withCoachWork(
  activity: AnalyzedActivity,
  feedback: ActivityFeedback | undefined,
  analysis: StoredAnalysis | undefined,
  programAnalysis: StoredAnalysis | undefined,
): AnalyzedActivity {
  return {
    ...activity,
    analysis: analysis === undefined ? null : toCoachAnalysis(analysis),
    analysisError: null,
    programAnalysis:
      programAnalysis === undefined ? null : toCoachAnalysis(programAnalysis),
    comment: feedback?.comment ?? null,
    coachReply: feedback?.reply ? toCoachAnalysis(feedback.reply) : null,
    reviewed: feedback?.reviewed ?? false,
  };
}

/** Overlays the latest stored feedback on a feed entry. */
export function withActivityFeedback(
  activity: AnalyzedActivity,
  feedback: ReadonlyMap<string, ActivityFeedback>,
): AnalyzedActivity {
  const entry = feedback.get(String(activity.id));
  if (entry === undefined) {
    return activity;
  }
  return {
    ...activity,
    comment: entry.comment,
    coachReply: entry.reply ? toCoachAnalysis(entry.reply) : null,
    reviewed: entry.reviewed,
  };
}

function toStoredActivity(row: ActivityRowData): AnalyzedActivity {
  return {
    id: row.activityId,
    name: row.name,
    type: row.type,
    startDate: row.startDate.toISOString(),
    distance: row.distance,
    movingTime: row.movingTime,
    elapsedTime: row.elapsedTime,
    totalElevationGain: row.totalElevationGain,
    ...(row.averagePower !== null ? { averagePower: row.averagePower } : {}),
    ...(row.normalizedPower !== null
      ? { normalizedPower: row.normalizedPower }
      : {}),
    ...(row.averageHeartRate !== null
      ? { averageHeartRate: row.averageHeartRate }
      : {}),
    ...(row.averageSpeed !== null ? { averageSpeed: row.averageSpeed } : {}),
    ...(row.maxSpeed !== null ? { maxSpeed: row.maxSpeed } : {}),
    ...(row.strengthSets !== null ? { strengthSets: row.strengthSets } : {}),
    ...(row.laps !== null ? { laps: row.laps } : {}),
    sampleCount: row.sampleCount,
    samples: row.samples ?? [],
    ...(row.route !== undefined && row.route !== null
      ? { route: row.route }
      : {}),
    analysis: null,
    analysisError: null,
    programAnalysis: null,
    comment: null,
    coachReply: null,
    reviewed: false,
  };
}

function toActivityRow(
  userId: number,
  activity: Activity,
  now: Date,
): NewActivityRow {
  const preview = summarizeActivity(activity);
  return {
    userId,
    activityId: activity.id,
    name: preview.name,
    type: preview.type,
    startDate: new Date(preview.startDate),
    distance: preview.distance,
    movingTime: preview.movingTime,
    elapsedTime: preview.elapsedTime,
    totalElevationGain: preview.totalElevationGain,
    averagePower: preview.averagePower ?? null,
    normalizedPower: preview.normalizedPower ?? null,
    averageHeartRate: preview.averageHeartRate ?? null,
    averageSpeed: preview.averageSpeed ?? null,
    maxSpeed: preview.maxSpeed ?? null,
    sampleCount: preview.sampleCount,
    strengthSets: preview.strengthSets ?? null,
    laps: preview.laps ?? null,
    samples: preview.samples,
    route: preview.route ?? null,
    createdAt: now,
    updatedAt: now,
  };
}
