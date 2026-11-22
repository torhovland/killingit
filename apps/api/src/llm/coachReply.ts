import type { PlanChangeScope } from "@killingit/shared";
import type { LlmProvider } from "./openrouter.js";
import { coachReplyResultSchema, resolvePlanChange } from "./coachResult.js";
import {
  buildCoachReplyMessages,
  type CoachReplyPromptInput,
} from "./coachReplyPrompt.js";
import { parsePlanJson, PlanJsonError } from "./planJson.js";
import { completeWithFallbacks } from "./resilientCompletion.js";
import { COACH_REPLY_TEMPERATURE } from "./sampling.js";

export interface CoachReplyCredentials {
  apiKey: string;
  model: string;
  /** Cancels the completion when a newer coach run starts. */
  signal?: AbortSignal;
}

/** A short coach reply and how far it says the input changes the plan. */
export interface CoachReplyOutcome {
  text: string;
  planChangeNeeded: boolean;
  planChangeScope: PlanChangeScope;
}

/**
 * Asks the provider for a short reply to an athlete input. The reply carries
 * the coach's judgement of whether the input changes the plan, so the refresh
 * decision costs no extra completion. A model that ignores the JSON contract
 * still produces a reply; the flag then defaults to true so a needed refresh is
 * never silently dropped.
 */
export async function generateCoachReply(
  provider: LlmProvider,
  credentials: CoachReplyCredentials,
  input: CoachReplyPromptInput,
  kind: "coach_reply" | "coaching_question",
): Promise<CoachReplyOutcome> {
  const text = await completeWithFallbacks(
    provider,
    credentials,
    buildCoachReplyMessages(input),
    {
      // Brief text; leave room for reasoning tokens on reasoning models.
      maxTokens: 1024,
      temperature: COACH_REPLY_TEMPERATURE,
      kind,
    },
  );
  // A one-off question is a conversation only, whatever the model returns.
  if (kind === "coaching_question") {
    return {
      text: text.trim(),
      planChangeNeeded: false,
      planChangeScope: "none",
    };
  }
  try {
    const parsed = parsePlanJson(coachReplyResultSchema, text);
    return {
      text: parsed.reply,
      ...resolvePlanChange(parsed),
    };
  } catch (err) {
    if (!(err instanceof PlanJsonError)) {
      throw err;
    }
    return {
      text: text.trim(),
      planChangeNeeded: true,
      planChangeScope: "season",
    };
  }
}
