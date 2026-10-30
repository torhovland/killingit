import {
  buildCoachPlanMessages,
  type CoachPlanInput,
} from "./coachPlanPrompt.js";
import type { LlmProvider } from "./openrouter.js";
import { PLAN_MAX_TOKENS } from "./planBudget.js";
import { completeWithFallbacks } from "./resilientCompletion.js";

export interface CoachPlanCredentials {
  apiKey: string;
  model: string;
  /** Cancels the completion when a newer coach run starts. */
  signal?: AbortSignal;
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
  return completeWithFallbacks(
    provider,
    credentials,
    buildCoachPlanMessages(input),
    // The plan covers a whole season plus the first block, week, and day, so
    // the output budget is larger than a single activity analysis. Reasoning
    // models also count their reasoning tokens against this cap.
    PLAN_MAX_TOKENS,
    0.4,
    { kind: "coach_plan" },
  );
}
