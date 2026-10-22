import type { LlmProvider } from "./openrouter.js";
import {
  buildProgramAnalysisMessages,
  type ProgramAnalysisInput,
} from "./programAnalysisPrompt.js";

export interface ProgramAnalysisCredentials {
  apiKey: string;
  model: string;
}

/** Asks the provider to review one activity against the athlete's plan. */
export function analyzeActivityAgainstPlan(
  provider: LlmProvider,
  credentials: ProgramAnalysisCredentials,
  input: ProgramAnalysisInput,
): Promise<string> {
  return provider.complete({
    apiKey: credentials.apiKey,
    model: credentials.model,
    messages: buildProgramAnalysisMessages(input),
    temperature: 0.3,
    // Leave room for reasoning tokens plus a complete 3-5 sentence review.
    maxTokens: 2048,
  });
}
