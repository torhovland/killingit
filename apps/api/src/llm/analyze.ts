import {
  coachAnalysisResultSchema,
  type Activity,
  type CoachAnalysisResult,
} from "@killingit/shared";
import {
  buildActivityAnalysisMessages,
  type ActivityAnalysisContext,
} from "./activityPrompt.js";
import type { LlmProvider } from "./openrouter.js";
import { ANALYSIS_MAX_TOKENS } from "./planBudget.js";
import { parsePlanJson, PlanJsonError } from "./planJson.js";
import { completeWithFallbacks } from "./resilientCompletion.js";

export interface AnalysisInput {
  apiKey: string;
  model: string;
  /** Cancels the completion when a newer coach run starts. */
  signal?: AbortSignal;
}

/**
 * Asks the provider for a coach analysis of one activity. The model returns
 * JSON so its FTP estimate can be stored alongside the visible text; a model
 * that ignores the contract and returns plain text still produces an analysis,
 * with no FTP estimate.
 */
export async function analyzeActivity(
  provider: LlmProvider,
  input: AnalysisInput,
  activity: Activity,
  context?: ActivityAnalysisContext,
  comment?: string | null,
): Promise<CoachAnalysisResult> {
  const text = await completeWithFallbacks(
    provider,
    input,
    buildActivityAnalysisMessages(activity, context, comment),
    // A generous ceiling lets a reasoning model finish in one attempt rather
    // than truncating the visible analysis and paying for fallback attempts.
    ANALYSIS_MAX_TOKENS,
    0.3,
    { kind: "activity_analysis" },
  );
  try {
    return parsePlanJson(coachAnalysisResultSchema, text);
  } catch (err) {
    if (!(err instanceof PlanJsonError)) {
      throw err;
    }
    return {
      analysis: text.trim() || "The coach did not return an analysis.",
      estimatedFtpWatts: null,
      weightKg: null,
      bodyFatPercent: null,
    };
  }
}
