import type { Activity } from "@killingit/shared";
import { buildActivityAnalysisMessages } from "./activityPrompt.js";
import type { LlmProvider } from "./openrouter.js";

export interface AnalysisInput {
  apiKey: string;
  model: string;
}

/** Asks the provider for a coach analysis of one activity. */
export function analyzeActivity(
  provider: LlmProvider,
  input: AnalysisInput,
  activity: Activity,
): Promise<string> {
  return provider.complete({
    apiKey: input.apiKey,
    model: input.model,
    messages: buildActivityAnalysisMessages(activity),
    temperature: 0.3,
    // Reasoning models count their reasoning tokens against this budget, so a
    // low cap truncates the visible analysis mid-sentence. 2048 leaves room for
    // reasoning plus a complete 3-5 sentence analysis.
    maxTokens: 2048,
  });
}
