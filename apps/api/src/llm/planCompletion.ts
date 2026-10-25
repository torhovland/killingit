import type { z } from "zod";
import type { LlmMessage, LlmProvider } from "./openrouter.js";
import { parsePlanJson, PlanJsonError } from "./planJson.js";
import {
  completeWithFallbacks,
  type CompletionCredentials,
} from "./resilientCompletion.js";

export type PlanCompletionCredentials = CompletionCredentials;

export interface PlanJsonCompletionOptions {
  /**
   * Extra instruction for the repair turn. Used when the caller knows a
   * constraint the generic validation message cannot express, such as the exact
   * dates a week must contain.
   */
  repairHint?: string;
}

/**
 * Sends a structured plan request with the shared reasoning-model fallbacks
 * (see {@link completeWithFallbacks}). This keeps non-reasoning models working
 * while giving reasoning models room for their thinking plus the JSON
 * response.
 */
export function completePlan(
  provider: LlmProvider,
  credentials: PlanCompletionCredentials,
  messages: LlmMessage[],
  maxTokens: number,
  temperature = 0.4,
): Promise<string> {
  return completeWithFallbacks(
    provider,
    credentials,
    messages,
    maxTokens,
    temperature,
  );
}

/**
 * Sends a plan request and validates the JSON. A model that returns a valid
 * object with the wrong shape gets one repair attempt that includes its own
 * response and the validation problems, because a different model may format
 * dates, enums, or arrays differently. If the repair also fails, the error
 * carries the actionable validation summary.
 */
export async function completePlanJson<T>(
  schema: z.ZodType<T>,
  provider: LlmProvider,
  credentials: PlanCompletionCredentials,
  messages: LlmMessage[],
  maxTokens: number,
  options: PlanJsonCompletionOptions = {},
): Promise<T> {
  const text = await completePlan(provider, credentials, messages, maxTokens);
  try {
    return parsePlanJson(schema, text);
  } catch (err) {
    if (!(err instanceof PlanJsonError)) {
      throw err;
    }
    const repaired = await completePlan(
      provider,
      credentials,
      repairMessages(messages, text, err, options.repairHint),
      maxTokens,
      0.2,
    );
    return parsePlanJson(schema, repaired);
  }
}

/** Builds the corrective turn that follows a rejected plan response. */
function repairMessages(
  messages: LlmMessage[],
  previous: string,
  error: PlanJsonError,
  repairHint: string | undefined,
): LlmMessage[] {
  return [
    ...messages,
    { role: "assistant", content: previous },
    {
      role: "user",
      content: [
        `Your previous response could not be used. ${error.message}`,
        ...(repairHint === undefined || repairHint.trim() === ""
          ? []
          : ["", repairHint.trim()]),
        "",
        'Return the corrected JSON object with exactly the required shape. Fix every problem listed above. The top-level object must contain every key named at the top level of the contract, with no wrapper or bare inner object. Use the exact field names and only the allowed string values from the contract; for every type field use either "workout" or "rest". Return only the JSON object; do not add markdown fences, headings, or commentary.',
      ].join("\n"),
    },
  ];
}
