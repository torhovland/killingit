import type { LlmClient } from "../../../apps/api/src/llm/client.js";
import {
  createOpenRouterProvider,
  type LlmCompletionRequest,
  type LlmProvider,
} from "../../../apps/api/src/llm/openrouter.js";
import type { CallRecord } from "./types.js";

interface RecordedLlm {
  client: LlmClient;
  calls: CallRecord[];
}

/**
 * Wraps the real OpenRouter provider and records every completion's kind,
 * tokens, cost and latency. The app's own `llm_calls` table is not used: the
 * harness reads the same provider the app would, without storing an encrypted
 * key for the simulated account.
 */
export function createRecordedLlm(
  apiKey: string,
  model: string,
  initialCalls: CallRecord[] = [],
): RecordedLlm {
  const calls: CallRecord[] = [...initialCalls];
  const base = createOpenRouterProvider();
  const detailed = base.completeDetailed?.bind(base);
  if (detailed === undefined) {
    throw new Error("the OpenRouter provider has no detailed completion");
  }
  const provider: LlmProvider = {
    id: base.id,
    listModels: () => base.listModels(),
    validateKey: (key) => base.validateKey(key),
    complete: async (request) => {
      const result = await recordDetailed(detailed, request, calls);
      return result.text;
    },
    completeDetailed: (request) => recordDetailed(detailed, request, calls),
  };
  return {
    client: { provider, apiKey, seasonModel: model, dailyModel: model },
    calls,
  };
}

async function recordDetailed(
  detailed: NonNullable<LlmProvider["completeDetailed"]>,
  request: LlmCompletionRequest,
  calls: CallRecord[],
): Promise<Awaited<ReturnType<NonNullable<LlmProvider["completeDetailed"]>>>> {
  const started = Date.now();
  try {
    const result = await detailed(request);
    calls.push(
      callRecord(request, started, {
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
        costUsd: result.usage?.costUsd ?? 0,
        finishReason: result.finishReason,
      }),
    );
    return result;
  } catch (err) {
    calls.push({
      ...callRecord(request, started, null),
      finishReason: "error",
    });
    throw err;
  }
}

function callRecord(
  request: LlmCompletionRequest,
  started: number,
  usage: {
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    finishReason: string | null;
  } | null,
): CallRecord {
  return {
    at: new Date(started).toISOString(),
    kind: request.kind ?? null,
    model: request.model,
    promptTokens: usage?.promptTokens ?? 0,
    completionTokens: usage?.completionTokens ?? 0,
    costUsd: usage?.costUsd ?? 0,
    durationMs: Date.now() - started,
    finishReason: usage?.finishReason ?? null,
  };
}
