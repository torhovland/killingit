import { planChangeScopeSchema, type PlanChangeScope } from "@killingit/shared";
import { z } from "zod";
import type { CoachReplyOutcome } from "./coachReply.js";
import { resolvePlanChange } from "./coachResult.js";
import type { LlmProvider } from "./openrouter.js";
import {
  buildCoachReplyBatchMessages,
  type CoachReplyBatchPromptInput,
} from "./coachReplyBatchPrompt.js";
import { parsePlanJson } from "./planJson.js";
import { completeWithFallbacks } from "./resilientCompletion.js";
import { COACH_REPLY_TEMPERATURE } from "./sampling.js";

export interface CoachReplyBatchCredentials {
  apiKey: string;
  model: string;
  /** Cancels the completion when a newer coach run starts. */
  signal?: AbortSignal | undefined;
}

const replyBatchSchema = z.object({
  replies: z.array(
    z.object({
      id: z.string().min(1),
      reply: z.string().min(1),
      /** The contract's scope; a missing one fails open when a change is asked. */
      planChangeScope: planChangeScopeSchema.catch("season").optional(),
      /** Still accepted so an older answer or a model ignoring the contract parses. */
      planChangeNeeded: z.boolean().catch(true),
    }),
  ),
});

/** One batched reply after the scope and boolean have been made consistent. */
interface BatchedReply {
  id: string;
  text: string;
  planChangeNeeded: boolean;
  planChangeScope: PlanChangeScope;
}

/** Derives each entry's decision, keeping the reply text unchanged. */
function toBatchedReplies(
  parsed: z.infer<typeof replyBatchSchema>,
): BatchedReply[] {
  return parsed.replies.map((entry) => ({
    id: entry.id,
    text: entry.reply.trim(),
    ...resolvePlanChange(entry),
  }));
}

/** Asks the provider to answer several athlete inputs in one completion. */
export async function generateCoachReplies(
  provider: LlmProvider,
  credentials: CoachReplyBatchCredentials,
  input: CoachReplyBatchPromptInput,
): Promise<Map<string, CoachReplyOutcome>> {
  const text = await completeWithFallbacks(
    provider,
    credentials,
    buildCoachReplyBatchMessages(input),
    {
      // One completion must hold every reply plus the model's reasoning.
      maxTokens: Math.min(4096, 1024 + input.items.length * 256),
      temperature: COACH_REPLY_TEMPERATURE,
      kind: "coach_reply",
      metadata: { batchSize: input.items.length },
    },
  );
  const parsed = parsePlanJson(replyBatchSchema, text);
  const replies = new Map<string, CoachReplyOutcome>();
  for (const entry of toBatchedReplies(parsed)) {
    replies.set(entry.id, {
      text: entry.text,
      planChangeNeeded: entry.planChangeNeeded,
      planChangeScope: entry.planChangeScope,
    });
  }
  return replies;
}
