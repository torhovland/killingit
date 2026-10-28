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
import { parsePlanJson, PlanJsonError } from "./planJson.js";
import { completeWithFallbacks } from "./resilientCompletion.js";

export interface AnalysisInput {
  apiKey: string;
  model: string;
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
): Promise<CoachAnalysisResult> {
  const text = await completeWithFallbacks(
    provider,
    input,
    buildActivityAnalysisMessages(activity, context),
    // Reasoning models count their reasoning tokens against this budget, so a
    // low cap truncates the visible analysis mid-sentence. 2048 leaves room for
    // reasoning plus a complete 3-5 sentence analysis; the fallbacks retry with
    // reasoning disabled or a larger budget if that still is not enough.
    2048,
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
