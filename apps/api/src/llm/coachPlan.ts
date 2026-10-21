import {
  buildCoachPlanMessages,
  type CoachPlanInput,
} from "./coachPlanPrompt.js";
import type { LlmProvider } from "./openrouter.js";

export interface CoachPlanCredentials {
  apiKey: string;
  model: string;
}

/**
 * Sends the combined four-level plan prompt. The lifecycle build uses the
 * smaller season/block/week/day prompts instead, but this remains the reference
 * path for models with a large output budget.
 */
export function generateCoachPlan(
  provider: LlmProvider,
  credentials: CoachPlanCredentials,
  input: CoachPlanInput,
): Promise<string> {
  return provider.complete({
    apiKey: credentials.apiKey,
    model: credentials.model,
    messages: buildCoachPlanMessages(input),
    temperature: 0.4,
    // The plan covers a whole season plus the first block, week, and day, so
    // the output budget is larger than a single activity analysis. Reasoning
    // models also count their reasoning tokens against this cap.
    maxTokens: 4096,
  });
}
