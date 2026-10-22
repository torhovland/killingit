import type { z } from "zod";
import {
  LlmProviderError,
  LlmTokenLimitError,
  type LlmMessage,
  type LlmProvider,
  type LlmReasoning,
} from "./openrouter.js";
import { parsePlanJson, PlanJsonError } from "./planJson.js";

export interface PlanCompletionCredentials {
  apiKey: string;
  model: string;
}

interface CompletionAttempt {
  maxTokens: number;
  reasoning?: LlmReasoning;
}

/**
 * Sends a structured plan request. Attempts are ordered from the least
 * intrusive to the most forceful:
 *
 * 1. the normal budget with minimal reasoning;
 * 2. the normal budget with reasoning disabled;
 * 3. a doubled budget with minimal reasoning;
 * 4. the normal budget without reasoning control, for models that reject the
 *    reasoning parameter.
 *
 * This keeps non-reasoning models working while giving reasoning models room
 * for their thinking plus the JSON response.
 */
export async function completePlan(
  provider: LlmProvider,
  credentials: PlanCompletionCredentials,
  messages: LlmMessage[],
  maxTokens: number,
  temperature = 0.4,
): Promise<string> {
  const doubled = Math.min(maxTokens * 2, 16384);
  const attempts: CompletionAttempt[] = [
    { maxTokens, reasoning: { effort: "minimal" } },
    { maxTokens, reasoning: { effort: "none" } },
    { maxTokens: doubled, reasoning: { effort: "minimal" } },
    { maxTokens },
  ];

  let lastError: unknown;
  for (const [index, attempt] of attempts.entries()) {
    try {
      return await provider.complete({
        apiKey: credentials.apiKey,
        model: credentials.model,
        messages,
        temperature,
        maxTokens: attempt.maxTokens,
        ...(attempt.reasoning !== undefined
          ? { reasoning: attempt.reasoning }
          : {}),
      });
    } catch (err) {
      lastError = err;

      // A larger budget or reduced reasoning may fit the same plan.
      if (err instanceof LlmTokenLimitError) {
        continue;
      }
      // Some models reject an unsupported reasoning effort or an oversized
      // max_tokens with a 400; try the next fallback before giving up.
      if (
        index < attempts.length - 1 &&
        err instanceof LlmProviderError &&
        err.status === 400
      ) {
        continue;
      }
      throw err;
    }
  }

  throw lastError;
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
      repairMessages(messages, text, err),
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
): LlmMessage[] {
  return [
    ...messages,
    { role: "assistant", content: previous },
    {
      role: "user",
      content: [
        `Your previous response could not be used. ${error.message}`,
        "",
        "Return the corrected JSON object with exactly the required shape. Fix every problem listed above. Return only the JSON object; do not add markdown fences, headings, or commentary.",
      ].join("\n"),
    },
  ];
}
