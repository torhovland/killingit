import {
  activityAverageSpeed,
  activityLocalDate,
  activityUsesPace,
  cadenceUnit,
  formatActivityPaceOrSpeed,
  formatDuration,
  hasLapStructure,
  type ActivityLap,
  type ActivitySummary,
  type AnalyzedActivity,
} from "@killingit/shared";
import {
  formatStrengthSets,
  summarizeStrengthSets,
} from "./strengthContext.js";

/** Most laps listed individually; the rest are reported as a count. */
const MAX_PROMPT_LAPS = 40;

/** A recent activity plus the coach analysis generated for it, if any. */
export interface RecentActivityContext {
  summary: ActivitySummary;
  analysis: string | null;
  /** The coach's latest reply to the athlete's comment on the activity. */
  coachReply?: string | null;
}

/** A manually recorded activity. */
export interface ManualActivityContext {
  id: number;
  startDate: string;
  details: string;
  /** The coach-estimated TSS for this entry, when it has one. */
  estimatedTss?: number | null;
  /** When the athlete last edited the entry; used to order FTP revisions. */
  updatedAt?: string;
}

/** A comment the athlete added to an activity. */
export interface ActivityCommentContext {
  activityId: string;
  comment: string;
  /** When the comment was last edited; used to order FTP revisions. */
  updatedAt?: string;
}

/** Adapts an analyzed activity for a plan prompt. */
export function toCoachPlanActivity(
  activity: AnalyzedActivity,
): RecentActivityContext {
  return {
    summary: activity,
    analysis: activity.analysis?.text ?? null,
    coachReply: activity.coachReply?.text ?? null,
  };
}

/**
 * Renders recent training for a prompt, including each activity's coach
 * analysis and the athlete's comment when there is one. The empty case tells
 * the model to plan conservatively.
 */
export function formatRecentActivities(
  entries: readonly RecentActivityContext[],
  comments: readonly ActivityCommentContext[] = [],
  timeZone?: string | null,
): string {
  if (entries.length === 0) {
    return "No recent activities were recorded. Assume the athlete is starting from the fitness and experience described in the profile, and build the plan conservatively.";
  }
  const commentsById = new Map(
    comments.map((entry) => [entry.activityId, entry.comment]),
  );
  return entries
    .map((entry, index) =>
      formatActivity(
        entry,
        index,
        commentsById.get(String(entry.summary.id)) ?? null,
        timeZone,
      ),
    )
    .join("\n");
}

/** Renders manually recorded activities for a prompt. */
export function formatManualActivities(
  entries: readonly ManualActivityContext[],
): string {
  return entries
    .map((entry, index) => {
      const tss =
        entry.estimatedTss !== undefined && entry.estimatedTss !== null
          ? ` (estimated TSS ${entry.estimatedTss})`
          : "";
      return `${index + 1}. ${entry.startDate} — ${entry.details}${tss}`;
    })
    .join("\n");
}

/** Renders activity comments for a prompt. */
export function formatActivityComments(
  entries: readonly ActivityCommentContext[],
): string {
  return entries
    .map((entry) => `- Activity ${entry.activityId}: ${entry.comment.trim()}`)
    .join("\n");
}

/**
 * Renders the recorded activity summary used by the activity review, the plan
 * and reply prompts, so they describe the same numbers the same way.
 */
export function formatActivitySummary(
  activity: Pick<
    ActivitySummary,
    | "name"
    | "type"
    | "startDate"
    | "distance"
    | "movingTime"
    | "elapsedTime"
    | "totalElevationGain"
    | "averageSpeed"
    | "maxSpeed"
    | "strengthSets"
    | "laps"
  >,
  sampleCount: number,
): string[] {
  const lines = [
    `- Name: ${activity.name}`,
    `- Type (recorded by the device; may be wrong): ${activity.type}`,
    `- Started: ${activity.startDate}`,
    `- Distance: ${(activity.distance / 1000).toFixed(2)} km`,
    `- Moving time: ${formatDuration(activity.movingTime)}, elapsed time: ${formatDuration(activity.elapsedTime)}`,
    `- Elevation gain: ${Math.round(activity.totalElevationGain)} m`,
  ];
  const averageSpeed = activityAverageSpeed(activity);
  if (averageSpeed !== null) {
    const formatted = formatActivityPaceOrSpeed(activity.type, averageSpeed);
    if (formatted !== null) {
      lines.push(`- ${averageSpeedLabel(activity.type)}: ${formatted}`);
    }
  }
  if (activity.maxSpeed !== null && activity.maxSpeed !== undefined) {
    const formatted = formatActivityPaceOrSpeed(
      activity.type,
      activity.maxSpeed,
    );
    if (formatted !== null) {
      lines.push(`- ${fastestSpeedLabel(activity.type)}: ${formatted}`);
    }
  }
  lines.push(`- Recorded samples: ${sampleCount}`);
  if (activity.strengthSets !== undefined) {
    lines.push(...formatStrengthSets(activity.strengthSets));
  }
  if (hasLapStructure(activity.laps)) {
    lines.push(...formatLaps(activity.laps, activity.type));
  }
  return lines;
}

function formatActivity(
  entry: RecentActivityContext,
  index: number,
  comment: string | null,
  timeZone: string | null | undefined,
): string {
  const { summary, analysis } = entry;
  const details: string[] = [];
  if (summary.distance > 0) {
    details.push(`${(summary.distance / 1000).toFixed(2)} km`);
  }
  const averageSpeed = activityAverageSpeed(summary);
  if (averageSpeed !== null) {
    const paceOrSpeed = formatActivityPaceOrSpeed(summary.type, averageSpeed);
    if (paceOrSpeed !== null) {
      details.push(paceOrSpeed);
    }
  }
  details.push(`${formatDuration(summary.movingTime)} moving`);
  if (summary.totalElevationGain > 0) {
    details.push(`${Math.round(summary.totalElevationGain)} m elevation`);
  }
  if (summary.normalizedPower != null) {
    details.push(
      `NP ${Math.round(summary.normalizedPower)} W${summary.averagePower != null ? ` (average ${Math.round(summary.averagePower)} W)` : ""}`,
    );
  }

  const lines = [
    `${index + 1}. ${activityLocalDate(summary, timeZone)} — ${summary.type} — ${summary.name}: ${details.join(", ")}.`,
  ];
  if (summary.strengthSets !== undefined && summary.strengthSets.length > 0) {
    lines.push(
      `   Strength sets: ${summarizeStrengthSets(summary.strengthSets)}`,
    );
  }
  if (hasLapStructure(summary.laps)) {
    lines.push(`   Laps: ${summarizeLaps(summary.laps)}`);
  }
  if (analysis !== null && analysis.trim() !== "") {
    lines.push(`   Coach analysis: ${analysis.trim()}`);
  } else {
    lines.push("   Coach analysis: not available.");
  }
  if (comment !== null && comment.trim() !== "") {
    lines.push(
      `   Athlete comment about this same activity (not an additional session): ${comment.trim()}`,
    );
  }
  if (
    entry.coachReply !== undefined &&
    entry.coachReply !== null &&
    entry.coachReply.trim() !== ""
  ) {
    lines.push(`   Coach reply to that comment: ${entry.coachReply.trim()}`);
  }
  return lines.join("\n");
}

/** The label for an activity's mean speed, using pace for pace-based sports. */
function averageSpeedLabel(type: string): string {
  return activityUsesPace(type) ? "Average pace" : "Average speed";
}

/** The label for an activity's fastest speed, using pace for pace-based sports. */
function fastestSpeedLabel(type: string): string {
  return activityUsesPace(type) ? "Fastest pace" : "Maximum speed";
}

/**
 * Renders one recorded lap's averages for a prompt. Only recorded values are
 * listed, so a lap without power or heart rate does not claim a zero.
 */
function formatLap(lap: ActivityLap, activityType: string): string | null {
  const parts: string[] = [];
  const duration = lap.movingTime ?? lap.elapsedTime;
  if (duration !== undefined) {
    parts.push(formatDuration(duration));
  }
  if (lap.distance !== undefined && lap.distance > 0) {
    parts.push(`${(lap.distance / 1000).toFixed(2)} km`);
  }
  if (lap.averagePower !== undefined) {
    parts.push(`avg ${Math.round(lap.averagePower)} W`);
  }
  if (lap.maxPower !== undefined) {
    parts.push(`max ${Math.round(lap.maxPower)} W`);
  }
  if (lap.averageSpeed !== undefined && lap.averageSpeed > 0) {
    const paceOrSpeed = formatActivityPaceOrSpeed(
      activityType,
      lap.averageSpeed,
    );
    if (paceOrSpeed !== null) {
      parts.push(paceOrSpeed);
    }
  }
  if (lap.averageHeartRate !== undefined) {
    parts.push(`avg ${Math.round(lap.averageHeartRate)} bpm`);
  }
  if (lap.maxHeartRate !== undefined) {
    parts.push(`max ${Math.round(lap.maxHeartRate)} bpm`);
  }
  if (lap.averageCadence !== undefined) {
    parts.push(
      `${Math.round(lap.averageCadence)} ${cadenceUnit(activityType)}`,
    );
  }
  if (lap.totalElevationGain !== undefined && lap.totalElevationGain > 0) {
    parts.push(`${Math.round(lap.totalElevationGain)} m climb`);
  }
  if (parts.length === 0) {
    return null;
  }
  const label = lap.type === undefined ? "" : ` (${lap.type})`;
  return `- Lap ${lap.index}${label}: ${parts.join(", ")}`;
}

/**
 * Renders the recorded laps with their averages, so the coach can judge
 * whether an interval or tempo session was executed as prescribed. Bounded so
 * a long auto-lap ride cannot dominate the prompt.
 */
export function formatLaps(
  laps: readonly ActivityLap[],
  activityType: string,
): string[] {
  const shown = laps.slice(0, MAX_PROMPT_LAPS);
  const lines = shown
    .map((lap) => formatLap(lap, activityType))
    .filter((line): line is string => line !== null);
  if (lines.length === 0) {
    return [];
  }
  if (laps.length > shown.length) {
    lines.push(`(${shown.length} of ${laps.length} recorded laps shown.)`);
  }
  return ["Recorded laps:", ...lines];
}

/** The min–max range of a lap channel with one unit, or null when unrecorded. */
function lapRange(
  values: readonly (number | undefined)[],
  unit: string,
): string | null {
  const recorded = values.filter(
    (value): value is number => value !== undefined && Number.isFinite(value),
  );
  if (recorded.length === 0) {
    return null;
  }
  const min = Math.round(Math.min(...recorded));
  const max = Math.round(Math.max(...recorded));
  return min === max ? `${min} ${unit}` : `${min}–${max} ${unit}`;
}

/**
 * A compact one-line lap summary for the plan and reply prompts. The activity
 * analysis gets the full table; every other prompt only needs to know that the
 * session had interval structure and how hard the laps were.
 */
export function summarizeLaps(laps: readonly ActivityLap[]): string {
  const parts = [`${laps.length} recorded`];
  const power = lapRange(
    laps.map((lap) => lap.averagePower),
    "W",
  );
  if (power !== null) {
    parts.push(`lap avg power ${power}`);
  }
  const heartRate = lapRange(
    laps.map((lap) => lap.averageHeartRate),
    "bpm",
  );
  if (heartRate !== null) {
    parts.push(`lap avg HR ${heartRate}`);
  }
  return parts.join(", ");
}
