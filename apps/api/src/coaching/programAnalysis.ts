import type {
  AnalyzedActivity,
  BodyMetricEstimate,
  CoachPlan,
  DailyHealthPoint,
  MetricPoint,
  ThresholdSummary,
} from "@killingit/shared";
import type { DietPromptContext } from "../diet/summary.js";
import { analyzeActivityAgainstPlan } from "../llm/programAnalysis.js";
import { PROGRAM_ANALYSIS_PROMPT_VERSION } from "../llm/programAnalysisPrompt.js";
import type {
  ActivityCommentContext,
  BodyMetricHistory,
} from "../llm/planContext.js";
import { loadAnalyses, saveAnalysis } from "../llm/analysisStore.js";
import { saveCoachQuestions } from "../plans/coachQuestions.js";
import { recordCoachBodyMetrics, recordCoachFtp } from "../metrics/store.js";
import { mapWithConcurrency } from "../lib/mapWithConcurrency.js";
import { commentIsNewerThanAnalysis } from "./analysisFreshness.js";
import {
  ftpBaselineAt,
  ftpTimeline,
  type ThresholdTimeline,
} from "../training/thresholds.js";
import type { LlmProvider } from "../llm/openrouter.js";

/** Bounded concurrency so a review batch does not flood OpenRouter. */
export const PROGRAM_REVIEW_CONCURRENCY = 3;

export interface AnalyzeActivitiesAgainstPlanInput {
  userId: number;
  provider: LlmProvider;
  apiKey: string;
  model: string;
  today: string;
  plan: CoachPlan;
  activities: readonly AnalyzedActivity[];
  activityComments: readonly ActivityCommentContext[];
  /** The stored FTP history, oldest first. */
  ftpHistory?: readonly MetricPoint[];
  /** The stored threshold timelines, used to colour the prompt's current FTP. */
  thresholdTimelines?: readonly ThresholdTimeline[];
  /** Every threshold measure in effect on the activity date. */
  thresholds?: readonly ThresholdSummary[];
  /** Stored daily health and recovery values for the prompt. */
  dailyHealth?: readonly DailyHealthPoint[];
  /** Stored body weight and body-fat history, including Garmin weigh-ins. */
  bodyHistory?: BodyMetricHistory;
  /** Meals from the last seven days and completed-week summaries. */
  diet?: DietPromptContext;
  /** Cancels the supplementary review when a newer run starts. */
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the database-backed reader. */
  loadReviews?: typeof loadAnalyses;
  /** Injectable for tests; defaults to the database-backed writer. */
  save?: typeof saveAnalysis;
  /** Injectable for tests; defaults to the database-backed writer. */
  saveFtp?: typeof recordCoachFtp;
  /** Injectable for tests; defaults to the database-backed writer. */
  saveBodyMetrics?: typeof recordCoachBodyMetrics;
}

/**
 * Reviews each recent activity against the finished plan and stores the review
 * as a `program` analysis. A failed review is logged and skipped: the plan is
 * already saved and must not be failed by a supplementary review.
 */
export async function analyzeActivitiesAgainstPlan(
  input: AnalyzeActivitiesAgainstPlanInput,
): Promise<void> {
  const loadReviews = input.loadReviews ?? loadAnalyses;
  const save = input.save ?? saveAnalysis;
  const saveFtp = input.saveFtp ?? recordCoachFtp;
  const saveBodyMetrics = input.saveBodyMetrics ?? recordCoachBodyMetrics;
  const storedReviews = await loadReviews(
    input.userId,
    input.activities.map((activity) => activity.id),
    "program",
  );
  const comments = new Map(
    input.activityComments.map((entry) => [
      entry.activityId,
      {
        text: entry.comment,
        updatedAt:
          entry.updatedAt === undefined ? null : new Date(entry.updatedAt),
      },
    ]),
  );
  const ftpEstimates: { date: string; watts: number }[] = [];
  const bodyMetrics: BodyMetricEstimate[] = [];
  const coachQuestions: string[] = [];

  await mapWithConcurrency(
    input.activities,
    PROGRAM_REVIEW_CONCURRENCY,
    async (activity) => {
      const comment = comments.get(String(activity.id));
      const stored = storedReviews.get(activity.id);
      // A review is a snapshot of the plan in force when it was written, so a
      // later plan refresh must not re-bill the athlete for the same review.
      // Only a newer comment carries evidence the stored review has not seen.
      if (
        stored !== undefined &&
        !commentIsNewerThanAnalysis(stored, comment?.updatedAt ?? null)
      ) {
        return;
      }

      try {
        const activityDate = activity.startDate.slice(0, 10);
        const currentFtpWatts =
          ftpBaselineAt(
            ftpTimeline(input.thresholdTimelines ?? []),
            activityDate,
          )?.watts ?? null;
        const result = await analyzeActivityAgainstPlan(
          input.provider,
          {
            apiKey: input.apiKey,
            model: input.model,
            ...(input.signal !== undefined ? { signal: input.signal } : {}),
          },
          {
            today: input.today,
            plan: input.plan,
            activity,
            comment: comment?.text ?? null,
            ...(input.ftpHistory !== undefined
              ? { ftpHistory: input.ftpHistory }
              : {}),
            ...(input.thresholds !== undefined
              ? { thresholds: input.thresholds }
              : {}),
            ...(input.dailyHealth !== undefined
              ? { dailyHealth: input.dailyHealth }
              : {}),
            ...(input.bodyHistory !== undefined
              ? { bodyHistory: input.bodyHistory }
              : {}),
            ...(input.diet !== undefined ? { diet: input.diet } : {}),
            currentFtpWatts,
          },
        );
        if (input.signal?.aborted === true) {
          return;
        }
        await save({
          userId: input.userId,
          activityId: activity.id,
          kind: "program",
          model: input.model,
          promptVersion: PROGRAM_ANALYSIS_PROMPT_VERSION,
          text: result.analysis,
        });
        if (
          result.coachQuestion !== undefined &&
          result.coachQuestion !== null
        ) {
          coachQuestions.push(result.coachQuestion);
        }
        if (result.estimatedFtpWatts !== null) {
          ftpEstimates.push({
            date: activityDate,
            watts: result.estimatedFtpWatts,
          });
        }
        if (result.weightKg !== null || result.bodyFatPercent !== null) {
          bodyMetrics.push({
            date: activityDate,
            weightKg: result.weightKg,
            bodyFatPercent: result.bodyFatPercent,
          });
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error(
          `[coaching] program review failed for activity ${activity.id}: ${detail}`,
        );
      }
    },
  );

  if (input.signal?.aborted === true) {
    return;
  }
  if (coachQuestions.length > 0) {
    try {
      await saveCoachQuestions({
        userId: input.userId,
        questions: coachQuestions,
        model: input.model,
        sourceKind: "program_analysis",
      });
    } catch (err) {
      console.error("[coaching] could not store coach questions:", err);
    }
  }

  for (const estimate of ftpEstimates.sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    try {
      await saveFtp({ userId: input.userId, ...estimate });
    } catch (err) {
      console.error("[metrics] could not store a program FTP estimate:", err);
    }
  }

  if (bodyMetrics.length > 0) {
    try {
      await saveBodyMetrics(
        input.userId,
        bodyMetrics.sort((a, b) => a.date.localeCompare(b.date)),
      );
    } catch (err) {
      console.error("[metrics] could not store program body metrics:", err);
    }
  }
}
