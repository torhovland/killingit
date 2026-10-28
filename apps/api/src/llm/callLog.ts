import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
} from "./openrouter.js";
import { saveLlmCall, type LlmCallSink, type NewLlmCall } from "./callStore.js";

export interface PromptLoggingOptions {
  /** The account the completion belongs to. */
  userId: number;
  /** Injectable for tests; defaults to the database writer. */
  save?: LlmCallSink;
  /** Injectable clock for tests; returns epoch milliseconds. */
  clock?: () => number;
}

/**
 * Wraps a provider so every completion attempt is stored with its prompt,
 * response (or error), and request metadata. Applied only in the app's real
 * provider setup, so test doubles never touch the database.
 *
 * The wrapper is deliberately fail-open: a logging failure must never break
 * coaching, so it is reported to the console and the completion is returned.
 */
export function withPromptLogging(
  provider: LlmProvider,
  options: PromptLoggingOptions,
): LlmProvider {
  const save = options.save ?? saveLlmCall;
  const clock = options.clock ?? Date.now;

  async function record(call: NewLlmCall): Promise<void> {
    try {
      await save(call);
    } catch (err) {
      console.error("[llm-log] could not store the prompt:", err);
    }
  }

  return {
    id: provider.id,
    listModels: () => provider.listModels(),
    validateKey: (apiKey) => provider.validateKey(apiKey),

    async complete(request) {
      const startedAt = clock();
      try {
        const result = await completeResult(provider, request);
        await record({
          userId: options.userId,
          kind: request.kind ?? "other",
          provider: provider.id,
          model: request.model,
          messages: request.messages,
          response: result.text,
          error: null,
          usage: result.usage,
          metadata: {
            ...requestMetadata(request),
            responseModel: result.model,
            finishReason: result.finishReason,
          },
          durationMs: elapsedMs(startedAt, clock()),
        });
        return result.text;
      } catch (err) {
        await record({
          userId: options.userId,
          kind: request.kind ?? "other",
          provider: provider.id,
          model: request.model,
          messages: request.messages,
          response: null,
          error: errorMessage(err),
          usage: null,
          metadata: requestMetadata(request),
          durationMs: elapsedMs(startedAt, clock()),
        });
        throw err;
      }
    },
  };
}

/** Uses the provider's rich completion when available. */
async function completeResult(
  provider: LlmProvider,
  request: LlmCompletionRequest,
): Promise<LlmCompletionResult> {
  if (provider.completeDetailed !== undefined) {
    return provider.completeDetailed(request);
  }
  return {
    text: await provider.complete(request),
    model: null,
    finishReason: null,
    usage: null,
  };
}

/** The request settings recorded alongside every prompt. */
function requestMetadata(
  request: LlmCompletionRequest,
): Record<string, unknown> {
  return {
    ...(request.metadata ?? {}),
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    ...(request.reasoning !== undefined
      ? { reasoning: request.reasoning }
      : {}),
  };
}

function elapsedMs(startedAt: number, finishedAt: number): number {
  return Math.max(0, Math.round(finishedAt - startedAt));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
