import type { LlmProvider } from "./openrouter.js";
import {
  buildCoachReplyMessages,
  type CoachReplyPromptInput,
} from "./coachReplyPrompt.js";

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
  return provider.complete({
    apiKey: credentials.apiKey,
    model: credentials.model,
    messages: buildCoachReplyMessages(input),
    temperature: 0.4,
    // Brief text; leave room for reasoning tokens on reasoning models.
    maxTokens: 1024,
  });
}
