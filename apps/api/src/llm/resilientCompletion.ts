import type { LlmPromptKind } from "@killingit/shared";
import {
  LlmAbortError,
  LlmProviderError,
  LlmTokenLimitError,
  type LlmMessage,
  type LlmProvider,
  type LlmReasoning,
} from "./openrouter.js";
import { MAX_COMPLETION_TOKENS } from "./planBudget.js";

export interface CompletionCredentials {
  apiKey: string;
  model: string;
  /** Cancels the completion when a newer coach run starts. */
  signal?: AbortSignal;
}

/** The coaching task and extra metadata recorded in the prompt log. */
export interface CompletionOptions {
  kind?: LlmPromptKind;
  metadata?: Record<string, unknown>;
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
 * 5. a small budget with reasoning disabled, for models that reject a large
 *    `max_tokens`;
 * 6. the small budget without reasoning control;
 * 7. the normal budget without reasoning control.
 *
 * Reasoning tokens count against `maxTokens`, so a model can exhaust the budget
 * before it writes any visible text. Retrying with less reasoning or a larger
 * budget avoids surfacing a truncated response as a hard failure. The small
 * budget is only added when the caller asks for more than 4,096 tokens; it
 * keeps models with a low output ceiling usable after a 400 rejection.
 */
export async function completeWithFallbacks(
  provider: LlmProvider,
  credentials: CompletionCredentials,
  messages: LlmMessage[],
  maxTokens: number,
  temperature = 0.4,
  options: CompletionOptions = {},
): Promise<string> {
  const doubled = Math.min(maxTokens * 2, MAX_COMPLETION_TOKENS);
  const attempts: CompletionAttempt[] = [
    { maxTokens, reasoning: { effort: "minimal" } },
    { maxTokens, reasoning: { effort: "none" } },
    { maxTokens: doubled, reasoning: { effort: "none" } },
    { maxTokens: doubled },
  ];
  if (maxTokens > 4096) {
    attempts.push(
      { maxTokens: 4096, reasoning: { effort: "none" } },
      { maxTokens: 4096 },
    );
  }
  attempts.push({ maxTokens });

  let lastError: unknown;
  for (const [index, attempt] of attempts.entries()) {
    if (credentials.signal?.aborted === true) {
      throw new LlmAbortError();
    }
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
        ...(options.kind !== undefined ? { kind: options.kind } : {}),
        ...(credentials.signal !== undefined
          ? { signal: credentials.signal }
          : {}),
        metadata: {
          ...(options.metadata ?? {}),
          attempt: index + 1,
          ofAttempts: attempts.length,
        },
      });
    } catch (err) {
      lastError = err;

      // A cancelled run must not spend another completion attempt.
      if (err instanceof LlmAbortError) {
        throw err;
      }
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
