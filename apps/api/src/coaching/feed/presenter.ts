import {
  activityLocalDate,
  type Activity,
  type AnalyzedActivity,
  type CoachPlan,
} from "@killingit/shared";
import { athleteFailureMessage } from "../../http/errors.js";
import type { StoredAnalysis } from "../../llm/analysisStore.js";
import { toCoachAnalysis, type ActivityFeedback } from "../../plans/replies.js";
import {
  buildActivityLoads,
  type ActivityLoads,
} from "../../training/activityLoad.js";
import { loadTrainingContext } from "../../training/context.js";
import { summarizeActivity, withActivityFeedback } from "../activityStore.js";
import type { AnalysisInputs } from "./analysis.js";

export interface ActivityFeed {
  model: string | null;
  activities: AnalyzedActivity[];
}

/**
 * Builds the training-load snapshots for the synced activity dates and the TSS
 * each activity contributes on its own. The FTP timeline includes any revised
 * test result the athlete mentioned, and the stored plan supplies coach TSS
 * estimates for the days it covers.
 */
export async function loadUserActivityTrainingLoads(
  userId: number,
  activities: readonly AnalyzedActivity[],
  plan: CoachPlan | undefined,
  timezone?: string | null,
): Promise<ActivityLoads> {
  const { thresholdTimelines, planTssByDate, manualTssByDate } =
    await loadTrainingContext(userId, plan, timezone);
  const tssByDate = new Map(planTssByDate);
  for (const [date, tss] of manualTssByDate) {
    tssByDate.set(date, tss);
  }
  return buildActivityLoads(
    activities,
    thresholdTimelines,
    timezone,
    tssByDate,
  );
}

/**
 * Attaches the day's fitness snapshot and the activity's own TSS for the page.
 * Used by the live feed, the cached feed route and the calendar.
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

interface AssembleFeedParams {
  history: readonly AnalyzedActivity[];
  inputs: AnalysisInputs;
  model: string | null;
  analyses: readonly AnalyzedActivity[];
  timezone: string | undefined;
}

/**
 * Combines the analysed activities with the history and attaches the training
 * load. Analyses are stored by the analysis phase and the activity rows by the
 * sync phase, so the response needs no second write.
 */
export function assembleFeed(params: AssembleFeedParams): ActivityFeed {
  const analyzedById = new Map(
    params.analyses.map((activity) => [String(activity.id), activity]),
  );
  return {
    model: params.model,
    activities: params.history.map((activity) => {
      const analyzed = analyzedById.get(String(activity.id));
      return withActivityLoad(
        analyzed ?? withActivityFeedback(activity, params.inputs.feedback),
        params.inputs.loads,
        params.timezone,
      );
    }),
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
    ...summarizeActivity(activity),
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

/** An activity shown before an LLM has been configured. */
export function withoutAnalysis(
  activity: Activity,
  feedback?: ActivityFeedback,
): AnalyzedActivity {
  return {
    ...summarizeActivity(activity),
    analysis: null,
    analysisError: null,
    programAnalysis: null,
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
  return {
    ...summarizeActivity(activity),
    analysis: null,
    // A provider answer the athlete can act on stays on the card; an internal
    // failure is logged and replaced by a generic reason.
    analysisError: athleteFailureMessage(err, {
      fallback: "The coach analysis could not be saved.",
      logLabel: `[coaching] analysis failed for activity ${activity.id}`,
    }),
    programAnalysis: program ? toCoachAnalysis(program) : null,
    comment: feedback?.comment ?? null,
    coachReply: feedback?.reply ? toCoachAnalysis(feedback.reply) : null,
    reviewed: feedback?.reviewed ?? false,
  };
}
