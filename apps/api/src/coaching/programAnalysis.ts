import type {
  AnalyzedActivity,
  CoachPlan,
  MetricPoint,
} from "@killingit/shared";
import { analyzeActivityAgainstPlan } from "../llm/programAnalysis.js";
import { PROGRAM_ANALYSIS_PROMPT_VERSION } from "../llm/programAnalysisPrompt.js";
import type { ActivityCommentContext } from "../llm/planContext.js";
import { saveAnalysis } from "../llm/analysisStore.js";
import { recordCoachFtp } from "../metrics/store.js";
import { mapWithConcurrency } from "../lib/mapWithConcurrency.js";
import { ftpBaselineAt, type FtpTimeline } from "../training/ftp.js";
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
  /** The stored FTP time series, oldest first. */
  ftpHistory?: readonly MetricPoint[];
  /** The FTP timeline used to colour the prompt's current value. */
  ftpTimeline?: FtpTimeline | null;
  /** Injectable for tests; defaults to the database-backed writer. */
  save?: typeof saveAnalysis;
  /** Injectable for tests; defaults to the database-backed writer. */
  saveFtp?: typeof recordCoachFtp;
}

/**
 * Reviews each recent activity against the finished plan and stores the review
 * as a `program` analysis. A failed review is logged and skipped: the plan is
 * already saved and must not be failed by a supplementary review.
 */
export async function analyzeActivitiesAgainstPlan(
  input: AnalyzeActivitiesAgainstPlanInput,
): Promise<void> {
  const save = input.save ?? saveAnalysis;
  const saveFtp = input.saveFtp ?? recordCoachFtp;
  const comments = new Map(
    input.activityComments.map((entry) => [entry.activityId, entry.comment]),
  );
  const ftpEstimates: { date: string; watts: number }[] = [];

  await mapWithConcurrency(
    input.activities,
    PROGRAM_REVIEW_CONCURRENCY,
    async (activity) => {
      try {
        const activityDate = activity.startDate.slice(0, 10);
        const currentFtpWatts =
          input.ftpTimeline === null || input.ftpTimeline === undefined
            ? null
            : (ftpBaselineAt(input.ftpTimeline, activityDate)?.watts ?? null);
        const result = await analyzeActivityAgainstPlan(
          input.provider,
          { apiKey: input.apiKey, model: input.model },
          {
            today: input.today,
            plan: input.plan,
            activity,
            comment: comments.get(String(activity.id)) ?? null,
            ...(input.ftpHistory !== undefined
              ? { ftpHistory: input.ftpHistory }
              : {}),
            currentFtpWatts,
          },
        );
        await save({
          userId: input.userId,
          activityId: activity.id,
          kind: "program",
          model: input.model,
          promptVersion: PROGRAM_ANALYSIS_PROMPT_VERSION,
          text: result.analysis,
        });
        if (result.estimatedFtpWatts !== null) {
          ftpEstimates.push({
            date: activityDate,
            watts: result.estimatedFtpWatts,
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

  for (const estimate of ftpEstimates.sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    try {
      await saveFtp({ userId: input.userId, ...estimate });
    } catch (err) {
      console.error("[metrics] could not store a program FTP estimate:", err);
    }
  }
}
