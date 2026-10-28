import {
  coachAnalysisResultSchema,
  type CoachAnalysisResult,
} from "@killingit/shared";
import type { LlmProvider } from "./openrouter.js";
import {
  buildProgramAnalysisMessages,
  type ProgramAnalysisInput,
} from "./programAnalysisPrompt.js";
import { parsePlanJson, PlanJsonError } from "./planJson.js";
import { completeWithFallbacks } from "./resilientCompletion.js";

export interface ProgramAnalysisCredentials {
  apiKey: string;
  model: string;
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
    // Leave room for reasoning tokens plus a complete 3-5 sentence review.
    2048,
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
