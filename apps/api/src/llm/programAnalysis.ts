import type { LlmProvider } from "./openrouter.js";
import {
  buildProgramAnalysisMessages,
  type ProgramAnalysisInput,
} from "./programAnalysisPrompt.js";
import { completeWithFallbacks } from "./resilientCompletion.js";

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
  return completeWithFallbacks(
    provider,
    credentials,
    buildProgramAnalysisMessages(input),
    // Leave room for reasoning tokens plus a complete 3-5 sentence review.
    2048,
    0.3,
    { kind: "program_analysis" },
  );
}
