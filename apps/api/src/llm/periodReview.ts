import type { LlmProvider } from "./openrouter.js";
import {
  buildPeriodReviewMessages,
  type PeriodReviewPromptInput,
} from "./periodReviewPrompt.js";
import { completeWithFallbacks } from "./resilientCompletion.js";

export interface PeriodReviewCredentials {
  apiKey: string;
  model: string;
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
    // Leave room for reasoning tokens plus a complete 3-5 sentence summary.
    2048,
    0.3,
    { kind: "period_review", metadata: { periodKind: input.kind } },
  );
}
