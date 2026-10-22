import type { Activity } from "@killingit/shared";
import {
  buildActivityAnalysisMessages,
  type ActivityAnalysisContext,
} from "./activityPrompt.js";
import type { LlmProvider } from "./openrouter.js";
import { completeWithFallbacks } from "./resilientCompletion.js";

export interface AnalysisInput {
  apiKey: string;
  model: string;
}

/** Asks the provider for a coach analysis of one activity. */
export function analyzeActivity(
  provider: LlmProvider,
  input: AnalysisInput,
  activity: Activity,
  context?: ActivityAnalysisContext,
): Promise<string> {
  return completeWithFallbacks(
    provider,
    input,
    buildActivityAnalysisMessages(activity, context),
    // Reasoning models count their reasoning tokens against this budget, so a
    // low cap truncates the visible analysis mid-sentence. 2048 leaves room for
    // reasoning plus a complete 3-5 sentence analysis; the fallbacks retry with
    // reasoning disabled or a larger budget if that still is not enough.
    2048,
    0.3,
  );
}
