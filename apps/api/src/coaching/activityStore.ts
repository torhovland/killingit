import {
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
import { recordedPowerSummary } from "../training/stress.js";
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
  route?: RoutePoint[] | undefined;
};

/**
 * The stored channels a sync can skip. The sidecar returns only the summary
 * for an activity the API already stores, so these are what a sync must not
 * blank. See `docs/specs/garmin-sync-known-activities.md`.
 */
type StoredChannels = Pick<
  ActivityPreview,
  | "sampleCount"
  | "samples"
  | "route"
  | "averagePower"
  | "normalizedPower"
  | "laps"
  | "strengthSets"
>;

/** A stored activity's id and the channels a detail-skipping sync omits. */
type StoredActivityPreview = StoredChannels & { id: number };

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
 *
 * `stored` is the activity's previous preview. A sync skips the detail, splits
 * and set calls for an activity the API already stores, so its payload carries
 * no samples, laps or sets; anything the fresh payload did not record keeps the
 * stored value instead of being wiped. A payload with samples is summarized
 * from those samples as before. See
 * `docs/specs/garmin-sync-known-activities.md`.
 */
export function summarizeActivity(
  activity: Activity,
  stored?: StoredChannels,
): ActivityPreview {
  const { samples, ...summary } = activity;
  if (samples.length === 0) {
    return {
      ...summary,
      ...storedPreviewOf(stored),
    };
  }
  const route = routeFromSamples(samples);
  const power = recordedPowerSummary(samples);
  return {
    ...summary,
    ...storedStructureOf(summary, stored),
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

/** The stored preview channels, or an empty one when nothing was recorded. */
function storedPreviewOf(stored: StoredChannels | undefined): StoredChannels {
  return {
    sampleCount: stored?.sampleCount ?? 0,
    samples: stored?.samples ?? [],
    ...(stored?.route !== undefined ? { route: stored.route } : {}),
    ...(stored?.averagePower !== undefined
      ? { averagePower: stored.averagePower }
      : {}),
    ...(stored?.normalizedPower !== undefined
      ? { normalizedPower: stored.normalizedPower }
      : {}),
    ...storedStructureOf(undefined, stored),
  };
}

/** Keeps stored laps and sets when the synced activity recorded none. */
function storedStructureOf(
  fresh: Pick<ActivitySummary, "laps" | "strengthSets"> | undefined,
  stored: StoredChannels | undefined,
): Pick<StoredChannels, "laps" | "strengthSets"> {
  const channels: Pick<StoredChannels, "laps" | "strengthSets"> = {};
  if ((fresh?.laps?.length ?? 0) === 0 && stored?.laps !== undefined) {
    channels.laps = stored.laps;
  }
  if (
    (fresh?.strengthSets?.length ?? 0) === 0 &&
    stored?.strengthSets !== undefined
  ) {
    channels.strengthSets = stored.strengthSets;
  }
  return channels;
}

/** Loads the account's stored activities, newest first, with the chosen preview columns. */
async function loadStoredActivities(
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
      withStoredCoachFields(
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
 *
 * `stored` is the previously loaded feed. A sync skips the bulk calls for an
 * activity it already has, so the stored preview is what keeps that activity's
 * samples, route, laps and sets from being blanked by the empty payload.
 */
export async function saveStoredActivities(
  userId: number,
  synced: readonly Activity[],
  deletedIds: ReadonlySet<string> = new Set(),
  stored: readonly StoredActivityPreview[] = [],
): Promise<void> {
  const now = new Date();
  const storedById = new Map(
    stored.map((activity) => [String(activity.id), activity]),
  );
  const rows = synced
    .filter((activity) => !deletedIds.has(String(activity.id)))
    .map((activity) =>
      toActivityRow(userId, activity, now, storedById.get(String(activity.id))),
    );
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
function withStoredCoachFields(
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
  stored?: StoredChannels,
): NewActivityRow {
  const preview = summarizeActivity(activity, stored);
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
