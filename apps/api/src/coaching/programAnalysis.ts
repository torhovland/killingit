import type { AnalyzedActivity, CoachPlan } from "@killingit/shared";
import { analyzeActivityAgainstPlan } from "../llm/programAnalysis.js";
import { PROGRAM_ANALYSIS_PROMPT_VERSION } from "../llm/programAnalysisPrompt.js";
import type { ActivityCommentContext } from "../llm/planContext.js";
import { saveAnalysis } from "../llm/analysisStore.js";
import { mapWithConcurrency } from "../lib/mapWithConcurrency.js";
import type { LlmProvider } from "../llm/openrouter.js";

/** Bounded concurrency so a review batch does not flood OpenRouter. */
export const PROGRAM_REVIEW_CONCURRENCY = 3;

export interface AnalyzeActivitiesAgainstPlanInput {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  today: string;
  plan: CoachPlan;
  activities: readonly AnalyzedActivity[];
  activityComments: readonly ActivityCommentContext[];
  /** Injectable for tests; defaults to the database-backed writer. */
  save?: typeof saveAnalysis;
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
  const comments = new Map(
    input.activityComments.map((entry) => [entry.activityId, entry.comment]),
  );

  await mapWithConcurrency(
    input.activities,
    PROGRAM_REVIEW_CONCURRENCY,
    async (activity) => {
      try {
        const text = await analyzeActivityAgainstPlan(
          input.provider,
          { apiKey: input.apiKey, model: input.model },
          {
            today: input.today,
            plan: input.plan,
            activity,
            comment: comments.get(String(activity.id)) ?? null,
          },
        );
        await save({
          activityId: activity.id,
          kind: "program",
          model: input.model,
          promptVersion: PROGRAM_ANALYSIS_PROMPT_VERSION,
          text,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error(
          `[coaching] program review failed for activity ${activity.id}: ${detail}`,
        );
      }
    },
  );
}
