import {
  activityLocalDate,
  recordedPowerSummary,
  type Activity,
  type ActivitySample,
  type ActivitySummary,
  type AnalyzedActivity,
  type RoutePoint,
} from "@killingit/shared";
import { downsample } from "../../lib/downsample.js";
import type { StoredAnalysis } from "../../llm/analysisStore.js";
import { LlmProviderError } from "../../llm/openrouter.js";
import { toCoachAnalysis, type ActivityFeedback } from "../../plans/replies.js";
import type { ActivityLoads } from "../../training/activityLoad.js";
import { routeFromSamples } from "../route.js";

/** Enough samples for a readable preview without bloating the cached feed. */
export const MAX_PREVIEW_SAMPLES = 120;

export interface ActivityFeed {
  model: string | null;
  activities: AnalyzedActivity[];
}

/**
 * Combines a fresh Garmin sync with the activities already stored for the
 * athlete. New activities are added, synced ones get their latest summary and
 * preview, and activities that have fallen outside Garmin's sync window keep
 * their stored analysis and feedback. Locally deleted activities are omitted.
 * Everything is returned newest first.
 */
export function mergeActivityHistory(
  previous: readonly AnalyzedActivity[],
  synced: readonly Activity[],
  deletedIds: ReadonlySet<string> = new Set(),
): AnalyzedActivity[] {
  const byId = new Map(
    previous
      .filter((activity) => !deletedIds.has(String(activity.id)))
      .map((activity) => [String(activity.id), activity]),
  );
  for (const activity of synced) {
    if (deletedIds.has(String(activity.id))) {
      continue;
    }
    const existing = byId.get(String(activity.id));
    byId.set(
      String(activity.id),
      existing === undefined
        ? withoutAnalysis(activity)
        : refreshSyncedActivity(existing, activity),
    );
  }
  return [...byId.values()].sort(
    (a, b) => Date.parse(b.startDate) - Date.parse(a.startDate),
  );
}

/**
 * Applies the latest stored athlete feedback to an activity in the history.
 * Also used by the cached feed route, which overlays a reply stored after the
 * cache was written.
 */
export function withFeedback(
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

/**
 * Attaches the day's fitness snapshot and the activity's own TSS for the page.
 * Also used by the cached feed route, whose stored payload may predate both
 * fields.
 */
export function withActivityLoad(
  activity: AnalyzedActivity,
  loads: ActivityLoads,
  timezone: string | null | undefined,
): AnalyzedActivity {
  return {
    ...activity,
    activityTss:
      loads.byActivityId.get(activity.id) ?? activity.activityTss ?? null,
    trainingLoad:
      loads.byDate.get(activityLocalDate(activity, timezone)) ?? null,
  };
}

/** Wraps cached analyses and athlete feedback in the shared response shape. */
export function withStoredAnalysis(
  activity: Activity,
  stored: StoredAnalysis,
  program: StoredAnalysis | null,
  feedback?: ActivityFeedback,
): AnalyzedActivity {
  return {
    ...summarize(activity),
    analysis: {
      text: stored.text,
      model: stored.model,
      generatedAt: stored.generatedAt.toISOString(),
      planChangeNeeded: stored.planChangeNeeded,
    },
    analysisError: null,
    programAnalysis: program ? toCoachAnalysis(program) : null,
    comment: feedback?.comment ?? null,
    coachReply: feedback?.reply ? toCoachAnalysis(feedback.reply) : null,
    reviewed: feedback?.reviewed ?? false,
  };
}

/** Shows a failed analysis on the card without losing stored feedback. */
export function failedAnalysis(
  activity: Activity,
  err: unknown,
  program: StoredAnalysis | null,
  feedback: ActivityFeedback | undefined,
): AnalyzedActivity {
  const detail =
    err instanceof LlmProviderError
      ? err.message
      : err instanceof Error
        ? err.name
        : "unknown error";
  console.error(
    `[coaching] analysis failed for activity ${activity.id}: ${detail}`,
  );
  return {
    ...summarize(activity),
    analysis: null,
    analysisError:
      err instanceof LlmProviderError
        ? err.message
        : "The coach analysis could not be saved.",
    programAnalysis: program ? toCoachAnalysis(program) : null,
    comment: feedback?.comment ?? null,
    coachReply: feedback?.reply ? toCoachAnalysis(feedback.reply) : null,
    reviewed: feedback?.reviewed ?? false,
  };
}

/**
 * Updates a stored activity's summary from a fresh sync while keeping the
 * coach analysis and athlete feedback already attached to it.
 */
function refreshSyncedActivity(
  previous: AnalyzedActivity,
  activity: Activity,
): AnalyzedActivity {
  return {
    ...summarize(activity),
    analysis: previous.analysis,
    analysisError: previous.analysisError,
    programAnalysis: previous.programAnalysis,
    comment: previous.comment,
    coachReply: previous.coachReply,
    reviewed: previous.reviewed,
  };
}

/** An activity shown before an LLM has been configured. */
function withoutAnalysis(
  activity: Activity,
  feedback?: ActivityFeedback,
): AnalyzedActivity {
  return {
    ...summarize(activity),
    analysis: null,
    analysisError: null,
    programAnalysis: null,
    comment: feedback?.comment ?? null,
    coachReply: feedback?.reply ? toCoachAnalysis(feedback.reply) : null,
    reviewed: feedback?.reviewed ?? false,
  };
}

/**
 * Strips the (large) timeseries, keeping the summary, its sample count, a
 * bounded sample preview for the activities page, and a bounded GPS route for
 * the activity map.
 */
function summarize(activity: Activity): ActivitySummary & {
  sampleCount: number;
  samples: ActivitySample[];
  route?: RoutePoint[];
} {
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
