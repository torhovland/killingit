import {
  LlmProviderError,
  LlmTokenLimitError,
  type LlmMessage,
  type LlmProvider,
  type LlmReasoning,
} from "./openrouter.js";

export interface CompletionCredentials {
  apiKey: string;
  model: string;
}

interface CompletionAttempt {
  maxTokens: number;
  reasoning?: LlmReasoning;
}

/**
 * Sends a text completion with fallbacks for reasoning models. Attempts are
 * ordered from the least intrusive to the most forceful:
 *
 * 1. the normal budget with minimal reasoning;
 * 2. the normal budget with reasoning disabled;
 * 3. a doubled budget with reasoning disabled;
 * 4. a doubled budget without reasoning control;
 * 5. the normal budget without reasoning control, for models that reject both
 *    the reasoning parameter and an oversized `max_tokens`.
 *
 * Reasoning tokens count against `maxTokens`, so a model can exhaust the budget
 * before it writes any visible text. Retrying with less reasoning or a larger
 * budget avoids surfacing a truncated response as a hard failure.
 */
export async function completeWithFallbacks(
  provider: LlmProvider,
  credentials: CompletionCredentials,
  messages: LlmMessage[],
  maxTokens: number,
  temperature = 0.4,
): Promise<string> {
  const doubled = Math.min(maxTokens * 2, 16384);
  const attempts: CompletionAttempt[] = [
    { maxTokens, reasoning: { effort: "minimal" } },
    { maxTokens, reasoning: { effort: "none" } },
    { maxTokens: doubled, reasoning: { effort: "none" } },
    { maxTokens: doubled },
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

      // A larger budget or reduced reasoning may fit the same response.
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
