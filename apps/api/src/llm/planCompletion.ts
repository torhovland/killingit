import {
  LlmProviderError,
  LlmTokenLimitError,
  type LlmMessage,
  type LlmProvider,
  type LlmReasoning,
} from "./openrouter.js";

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
        temperature: 0.4,
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
