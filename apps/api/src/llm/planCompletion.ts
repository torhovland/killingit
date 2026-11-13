import type { LlmPromptKind } from "@killingit/shared";
import type { z } from "zod";
import type { LlmMessage, LlmProvider } from "./openrouter.js";
import {
  COMPLETION_BUDGET_MS,
  PLAN_LEVEL_MAX_COMPLETIONS,
} from "./planBudget.js";
import { parsePlanJson, PlanJsonError } from "./planJson.js";
import {
  completeWithFallbacks,
  completionBudgetLeft,
  createCompletionBudget,
  type CompletionCredentials,
  type CompletionOptions,
} from "./resilientCompletion.js";

export type PlanCompletionCredentials = CompletionCredentials;

export interface PlanJsonCompletionOptions {
  /**
   * Extra instruction for the repair turn. Used when the caller knows a
   * constraint the generic validation message cannot express, such as the exact
   * dates a week must contain.
   */
  repairHint?: string;
  /** The coaching task, recorded in the prompt log. */
  kind?: LlmPromptKind;
  /** Extra prompt-log metadata such as the season or week being planned. */
  metadata?: Record<string, unknown>;
}

/**
 * Sends a plan request and validates the JSON. A model that returns an invalid
 * response gets a compact repair turn first: it keeps the system contract, the
 * previous response and the validation problems, but drops the large user
 * context. That is enough for most shape errors and avoids re-sending the whole
 * prompt. If the compact repair also fails, one full-context repair is tried.
 *
 * Every attempt goes through {@link completeWithFallbacks}, so it carries the
 * shared reasoning-model fallbacks: a model that stops at the token limit is
 * retried with reasoning disabled before the normal budget without a reasoning
 * control. One completion budget covers the initial response, its fallback
 * chain and both repair turns, so a model that keeps truncating or keeps
 * returning unusable JSON stops after `PLAN_LEVEL_MAX_COMPLETIONS` billed
 * completions.
 */
export async function completePlanJson<T>(
  schema: z.ZodType<T>,
  provider: LlmProvider,
  credentials: PlanCompletionCredentials,
  messages: LlmMessage[],
  maxTokens: number,
  options: PlanJsonCompletionOptions = {},
): Promise<T> {
  const budget = createCompletionBudget({
    attempts: PLAN_LEVEL_MAX_COMPLETIONS,
    budgetMs: COMPLETION_BUDGET_MS,
  });
  const callOptions: CompletionOptions = {
    ...(options.kind !== undefined ? { kind: options.kind } : {}),
    ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
    budget,
  };
  const text = await completeWithFallbacks(
    provider,
    credentials,
    messages,
    maxTokens,
    0.4,
    callOptions,
  );
  try {
    return parsePlanJson(schema, text);
  } catch (err) {
    if (!(err instanceof PlanJsonError)) {
      throw err;
    }
    // The repair turns draw on the same budget; when the initial response used
    // it all, report the validation failure instead of billing another call.
    if (!completionBudgetLeft(budget)) {
      throw err;
    }
    const compact = canUseCompactRepair(messages);
    const repaired = await completeWithFallbacks(
      provider,
      credentials,
      repairMessages(messages, text, err, options.repairHint, compact),
      maxTokens,
      0.2,
      {
        ...callOptions,
        metadata: {
          ...(options.metadata ?? {}),
          repair: true,
          repairContext: compact ? "compact" : "full",
        },
      },
    );
    try {
      return parsePlanJson(schema, repaired);
    } catch (retryErr) {
      if (!(retryErr instanceof PlanJsonError) || !compact) {
        throw retryErr;
      }
      const full = await completeWithFallbacks(
        provider,
        credentials,
        repairMessages(messages, text, retryErr, options.repairHint, false),
        maxTokens,
        0.2,
        {
          ...callOptions,
          metadata: {
            ...(options.metadata ?? {}),
            repair: true,
            repairContext: "full",
            repairAttempt: 2,
          },
        },
      );
      return parsePlanJson(schema, full);
    }
  }
}

/** A system prompt carries the contract, so a compact repair is meaningful. */
function canUseCompactRepair(messages: readonly LlmMessage[]): boolean {
  return messages.some((message) => message.role === "system");
}

/**
 * Builds the corrective turn that follows a rejected plan response. A compact
 * repair keeps the system contract and the rejected response; a full repair
 * also keeps the original user context.
 */
function repairMessages(
  messages: LlmMessage[],
  previous: string,
  error: PlanJsonError,
  repairHint: string | undefined,
  compact: boolean,
): LlmMessage[] {
  return [
    ...(compact
      ? messages.filter((message) => message.role === "system")
      : messages),
    { role: "assistant", content: previous },
    {
      role: "user",
      content: [
        `Your previous response could not be used. ${error.message}`,
        ...(repairHint === undefined || repairHint.trim() === ""
          ? []
          : ["", repairHint.trim()]),
        "",
        'Return the corrected JSON object with exactly the required shape. Fix every problem listed above. The top-level object must contain every key named at the top level of the contract, with no wrapper or bare inner object. Use the exact field names and only the allowed string values from the contract; for every type field use either "workout" or "rest". Keep every value in the previous response that is already valid. Return only the JSON object; do not add markdown fences, headings, or commentary.',
      ].join("\n"),
    },
  ];
}
