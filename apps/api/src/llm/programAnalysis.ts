import {
  coachAnalysisResultSchema,
  type CoachAnalysisResult,
} from "@killingit/shared";
import type { LlmProvider } from "./openrouter.js";
import {
  buildProgramAnalysisMessages,
  type ProgramAnalysisInput,
} from "./programAnalysisPrompt.js";
import { ANALYSIS_MAX_TOKENS } from "./planBudget.js";
import { parsePlanJson, PlanJsonError } from "./planJson.js";
import { completeWithFallbacks } from "./resilientCompletion.js";

export interface ProgramAnalysisCredentials {
  apiKey: string;
  model: string;
  /** Cancels the completion when a newer coach run starts. */
  signal?: AbortSignal;
}

/** Asks the provider to review one activity against the athlete's plan. */
export async function analyzeActivityAgainstPlan(
  provider: LlmProvider,
  credentials: ProgramAnalysisCredentials,
  input: ProgramAnalysisInput,
): Promise<CoachAnalysisResult> {
  const text = await completeWithFallbacks(
    provider,
    credentials,
    buildProgramAnalysisMessages(input),
    // A generous ceiling lets a reasoning model finish in one attempt rather
    // than truncating the review and paying for fallback attempts.
    ANALYSIS_MAX_TOKENS,
    0.3,
    { kind: "program_analysis" },
  );
  try {
    return parsePlanJson(coachAnalysisResultSchema, text);
  } catch (err) {
    if (!(err instanceof PlanJsonError)) {
      throw err;
    }
    return {
      analysis: text.trim() || "The coach did not return a review.",
      estimatedFtpWatts: null,
      weightKg: null,
      bodyFatPercent: null,
    };
  }
}
