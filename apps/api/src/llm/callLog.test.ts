import { describe, expect, it } from "bun:test";
import type { LlmCompletionRequest, LlmProvider } from "./openrouter.js";
import { LlmAbortError, LlmTokenLimitError } from "./openrouter.js";
import { withPromptLogging } from "./callLog.js";
import type { LlmCallResult, LlmCallSink, NewLlmCall } from "./callStore.js";
import { completeWithFallbacks } from "./resilientCompletion.js";

class StubProvider implements LlmProvider {
  readonly id = "stub";
  requests: LlmCompletionRequest[] = [];

  constructor(
    private readonly respond: (
      request: LlmCompletionRequest,
    ) => string | Promise<string>,
  ) {}

  listModels(): Promise<never[]> {
    return Promise.resolve([]);
  }

  validateKey(): Promise<void> {
    return Promise.resolve();
  }

  complete(request: LlmCompletionRequest): Promise<string> {
    this.requests.push(request);
    return Promise.resolve(this.respond(request));
  }
}

interface RecordedCall {
  started: NewLlmCall;
  result: LlmCallResult | null;
}

function recordingSink(): { calls: RecordedCall[]; sink: LlmCallSink } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    sink: {
      start: (call) => {
        calls.push({ started: call, result: null });
        return Promise.resolve(calls.length);
      },
      finish: (id, result) => {
        const call = calls[id - 1];
        if (call !== undefined) {
          call.result = result;
        }
        return Promise.resolve();
      },
    },
  };
}

const messages = [
  { role: "system" as const, content: "You are a coach." },
  { role: "user" as const, content: "Plan my season." },
];

function request(overrides: Partial<LlmCompletionRequest> = {}) {
  return {
    apiKey: "test-key",
    model: "openrouter/model",
    messages,
    temperature: 0.4,
    maxTokens: 1024,
    kind: "season_plan" as const,
    ...overrides,
  };
}

describe("withPromptLogging", () => {
  it("stores the prompt, response, kind, and request metadata", async () => {
    const { calls, sink } = recordingSink();
    let now = 0;
    const provider = new StubProvider(() => "The plan is ready.");
    const wrapped = withPromptLogging(provider, {
      userId: 7,
      sink,
      clock: () => {
        now += 7;
        return now;
      },
    });

    const text = await wrapped.complete(request({ metadata: { attempt: 1 } }));

    expect(text).toBe("The plan is ready.");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.started).toMatchObject({
      userId: 7,
      kind: "season_plan",
      provider: "stub",
      model: "openrouter/model",
      messages,
    });
    expect(calls[0]?.started.metadata).toMatchObject({
      attempt: 1,
      temperature: 0.4,
      maxTokens: 1024,
    });
    expect(calls[0]?.result).toMatchObject({
      response: "The plan is ready.",
      error: null,
      usage: null,
      durationMs: 7,
    });
    expect(calls[0]?.result?.metadata).toMatchObject({
      responseModel: null,
      finishReason: null,
    });
  });

  it("records the attempt before sending the request", async () => {
    const { calls, sink } = recordingSink();
    let seenBeforeSend = 0;
    const provider = new StubProvider(() => {
      seenBeforeSend = calls.length;
      return "Ready";
    });
    const wrapped = withPromptLogging(provider, { userId: 7, sink });

    await wrapped.complete(request());

    expect(seenBeforeSend).toBe(1);
  });

  it("uses the provider's rich completion for usage and routing metadata", async () => {
    const { calls, sink } = recordingSink();
    const provider: LlmProvider = {
      id: "stub",
      listModels: () => Promise.resolve([]),
      validateKey: () => Promise.resolve(),
      complete: () => Promise.reject(new Error("complete should not be used")),
      completeDetailed: () =>
        Promise.resolve({
          text: "Detailed response",
          model: "routed/model",
          finishReason: "stop",
          usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
        }),
    };
    const wrapped = withPromptLogging(provider, { userId: 3, sink });

    const text = await wrapped.complete(request());

    expect(text).toBe("Detailed response");
    expect(calls[0]?.result?.usage).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
    });
    expect(calls[0]?.result?.metadata).toMatchObject({
      responseModel: "routed/model",
      finishReason: "stop",
    });
  });

  it("stores failures and rethrows the provider error", async () => {
    const { calls, sink } = recordingSink();
    const provider: LlmProvider = {
      id: "stub",
      listModels: () => Promise.resolve([]),
      validateKey: () => Promise.resolve(),
      complete: () => Promise.reject(new Error("provider exploded")),
    };
    const wrapped = withPromptLogging(provider, { userId: 9, sink });

    const error: unknown = await wrapped
      .complete(request())
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("provider exploded");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.started).toMatchObject({
      userId: 9,
      kind: "season_plan",
      messages,
    });
    expect(calls[0]?.result).toMatchObject({
      response: null,
      error: "provider exploded",
      usage: null,
    });
  });

  it("records a cancelled attempt without marking it failed", async () => {
    const { calls, sink } = recordingSink();
    const provider: LlmProvider = {
      id: "stub",
      listModels: () => Promise.resolve([]),
      validateKey: () => Promise.resolve(),
      complete: () => Promise.reject(new LlmAbortError()),
    };
    const wrapped = withPromptLogging(provider, { userId: 9, sink });

    await wrapped.complete(request()).catch(() => undefined);

    expect(calls[0]?.result).toMatchObject({
      response: null,
      error: null,
      metadata: { cancelled: true },
    });
  });

  it("does not break the completion when starting the log fails", async () => {
    const provider = new StubProvider(() => "Still works");
    const wrapped = withPromptLogging(provider, {
      userId: 1,
      sink: {
        start: () => Promise.reject(new Error("database down")),
        finish: () => Promise.resolve(),
      },
    });

    expect(await wrapped.complete(request())).toBe("Still works");
  });

  it("does not break the completion when finishing the log fails", async () => {
    const provider = new StubProvider(() => "Still works");
    const wrapped = withPromptLogging(provider, {
      userId: 1,
      sink: {
        start: () => Promise.resolve(1),
        finish: () => Promise.reject(new Error("database down")),
      },
    });

    expect(await wrapped.complete(request())).toBe("Still works");
  });

  it("logs every retry attempt with its attempt number", async () => {
    const { calls, sink } = recordingSink();
    let attempts = 0;
    const provider = new StubProvider(() => {
      attempts += 1;
      if (attempts === 1) {
        throw new LlmTokenLimitError("too long");
      }
      return "Recovered";
    });
    const wrapped = withPromptLogging(provider, { userId: 5, sink });

    const text = await completeWithFallbacks(
      wrapped,
      { apiKey: "test-key", model: "openrouter/model" },
      messages,
      2048,
      0.4,
      { kind: "activity_analysis" },
    );

    expect(text).toBe("Recovered");
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.started.metadata.attempt)).toEqual([1, 2]);
    expect(calls[0]?.result?.error).toBe("too long");
    expect(calls[1]?.result?.response).toBe("Recovered");
    expect(
      calls.every((call) => call.started.kind === "activity_analysis"),
    ).toBe(true);
  });
});
