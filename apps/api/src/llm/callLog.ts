import {
  isLlmAbortError,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type LlmProvider,
} from "./openrouter.js";
import {
  dbLlmCallSink,
  type LlmCallResult,
  type LlmCallSink,
  type NewLlmCall,
} from "./callStore.js";

export interface PromptLoggingOptions {
  /** The account the completion belongs to. */
  userId: number;
  /** Injectable for tests; defaults to the database writer. */
  sink?: LlmCallSink;
  /** Injectable clock for tests; returns epoch milliseconds. */
  clock?: () => number;
}

/**
 * Wraps a provider so every completion attempt is stored with its prompt,
 * response (or error), and request metadata. The attempt is written before the
 * request is sent, so a process that stops while waiting for the model still
 * leaves a row that can be marked failed. Applied only in the app's real
 * provider setup, so test doubles never touch the database.
 *
 * The wrapper is deliberately fail-open: a logging failure must never break
 * coaching, so it is reported to the console and the completion is returned.
 */
export function withPromptLogging(
  provider: LlmProvider,
  options: PromptLoggingOptions,
): LlmProvider {
  const sink = options.sink ?? dbLlmCallSink;
  const clock = options.clock ?? Date.now;

  async function start(call: NewLlmCall): Promise<number | null> {
    try {
      return await sink.start(call);
    } catch (err) {
      console.error("[llm-log] could not store the prompt:", err);
      return null;
    }
  }

  async function finish(id: number, result: LlmCallResult): Promise<void> {
    try {
      await sink.finish(id, result);
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
      const id = await start({
        userId: options.userId,
        kind: request.kind ?? "other",
        provider: provider.id,
        model: request.model,
        messages: request.messages,
        metadata: requestMetadata(request),
      });
      try {
        const result = await completeResult(provider, request);
        if (id !== null) {
          await finish(id, {
            response: result.text,
            error: null,
            usage: result.usage,
            metadata: {
              responseModel: result.model,
              finishReason: result.finishReason,
            },
            durationMs: elapsedMs(startedAt, clock()),
          });
        }
        return result.text;
      } catch (err) {
        const cancelled = isLlmAbortError(err);
        if (id !== null) {
          await finish(id, {
            response: null,
            // A superseded run is not a coaching failure; keep it out of the
            // error count but record that the attempt was cancelled.
            error: cancelled ? null : errorMessage(err),
            usage: null,
            metadata: cancelled ? { cancelled: true } : {},
            durationMs: elapsedMs(startedAt, clock()),
          });
        }
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
