import type { LlmProvider } from "./openrouter.js";
import {
  buildCoachReplyMessages,
  type CoachReplyPromptInput,
} from "./coachReplyPrompt.js";
import { completeWithFallbacks } from "./resilientCompletion.js";

export interface CoachReplyCredentials {
  apiKey: string;
  model: string;
}

/** Asks the provider for a short reply to an athlete input. */
export function generateCoachReply(
  provider: LlmProvider,
  credentials: CoachReplyCredentials,
  input: CoachReplyPromptInput,
): Promise<string> {
  return completeWithFallbacks(
    provider,
    credentials,
    buildCoachReplyMessages(input),
    // Brief text; leave room for reasoning tokens on reasoning models.
    1024,
    0.4,
  );
}
