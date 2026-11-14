import {
  isLlmAbortError,
  LlmProviderError,
  LlmTokenLimitError,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type LlmProvider,
} from "../../../apps/api/src/llm/openrouter.js";
import type { PromptUsage } from "./promptBenchmarkTypes.js";

/** One provider call, normalized for the benchmark's attempt records. */
export interface PromptCompletion {
  text: string;
  finishReason: string | null;
  usage: PromptUsage | null;
  costUsd: number;
  httpStatus: number | null;
  error: string | null;
}

function completeWithUsage(
  provider: LlmProvider,
  request: LlmCompletionRequest,
): Promise<LlmCompletionResult> {
  if (provider.completeDetailed !== undefined) {
    return provider.completeDetailed(request);
  }
  return provider.complete(request).then((text) => ({
    text,
    model: null,
    finishReason: null,
    usage: null,
  }));
}

/**
 * Calls the app's `LlmProvider` with a caller-supplied time limit and turns the
 * result or the provider error into one normalised completion record. Both the
 * candidate and judge stages use this, so a benchmark call has exactly the
 * headers, temperature handling and error mapping the app has.
 */
export async function completePrompt(
  provider: LlmProvider,
  request: Omit<LlmCompletionRequest, "signal">,
  timeoutMs: number,
): Promise<PromptCompletion> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const result = await completeWithUsage(provider, { ...request, signal });
    return {
      text: result.text,
      finishReason: result.finishReason,
      usage:
        result.usage === null
          ? null
          : {
              prompt_tokens: result.usage.promptTokens,
              completion_tokens: result.usage.completionTokens,
              total_tokens: result.usage.totalTokens,
              cost: result.usage.costUsd ?? null,
            },
      costUsd: result.usage?.costUsd ?? 0,
      httpStatus: 200,
      error: null,
    };
  } catch (err) {
    return {
      text: "",
      finishReason: err instanceof LlmTokenLimitError ? "length" : null,
      usage: null,
      costUsd: 0,
      httpStatus: err instanceof LlmProviderError ? err.status : null,
      error:
        signal.aborted || isLlmAbortError(err)
          ? `timed out after ${Math.round(timeoutMs / 1000)}s`
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }
}
