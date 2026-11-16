import type { LlmProvider } from "./openrouter.js";
import {
  buildPeriodReviewMessages,
  type PeriodReviewPromptInput,
} from "./periodReviewPrompt.js";
import { completeWithFallbacks } from "./resilientCompletion.js";
import { ANALYSIS_TEMPERATURE } from "./sampling.js";

export interface PeriodReviewCredentials {
  apiKey: string;
  model: string;
  /** Cancels the completion when a newer coach run starts. */
  signal?: AbortSignal;
}

/** Asks the provider for a summary of a completed week or block. */
export function generatePeriodReview(
  provider: LlmProvider,
  credentials: PeriodReviewCredentials,
  input: PeriodReviewPromptInput,
): Promise<string> {
  return completeWithFallbacks(
    provider,
    credentials,
    buildPeriodReviewMessages(input),
    {
      // Leave room for reasoning tokens plus a complete 3-5 sentence summary.
      maxTokens: 2048,
      temperature: ANALYSIS_TEMPERATURE,
      kind: "period_review",
      metadata: { periodKind: input.kind },
    },
  );
}
