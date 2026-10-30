import { z } from "zod";
import type { LlmProvider } from "./openrouter.js";
import {
  buildCoachReplyBatchMessages,
  type CoachReplyBatchPromptInput,
} from "./coachReplyBatchPrompt.js";
import { parsePlanJson } from "./planJson.js";
import { completeWithFallbacks } from "./resilientCompletion.js";

export interface CoachReplyBatchCredentials {
  apiKey: string;
  model: string;
  /** Cancels the completion when a newer coach run starts. */
  signal?: AbortSignal;
}

const replyBatchSchema = z.object({
  replies: z.array(
    z.object({
      id: z.string().min(1),
      reply: z.string().min(1),
    }),
  ),
});

/** Asks the provider to answer several athlete inputs in one completion. */
export async function generateCoachReplies(
  provider: LlmProvider,
  credentials: CoachReplyBatchCredentials,
  input: CoachReplyBatchPromptInput,
): Promise<Map<string, string>> {
  const text = await completeWithFallbacks(
    provider,
    credentials,
    buildCoachReplyBatchMessages(input),
    // One completion must hold every reply plus the model's reasoning.
    Math.min(4096, 1024 + input.items.length * 256),
    0.4,
    { kind: "coach_reply", metadata: { batchSize: input.items.length } },
  );
  const parsed = parsePlanJson(replyBatchSchema, text);
  const replies = new Map<string, string>();
  for (const entry of parsed.replies) {
    replies.set(entry.id, entry.reply.trim());
  }
  return replies;
}
