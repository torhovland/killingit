import { describe, expect, it } from "bun:test";
import type { LlmCompletionRequest, LlmProvider } from "./openrouter.js";
import { LlmTokenLimitError } from "./openrouter.js";
import { withPromptLogging } from "./callLog.js";
import { completeWithFallbacks } from "./resilientCompletion.js";
import type { NewLlmCall } from "./callStore.js";

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
    const saved: NewLlmCall[] = [];
    let now = 0;
    const provider = new StubProvider(() => "The plan is ready.");
    const wrapped = withPromptLogging(provider, {
      userId: 7,
      save: (call) => {
        saved.push(call);
        return Promise.resolve();
      },
      clock: () => {
        now += 7;
        return now;
      },
    });

    const text = await wrapped.complete(request({ metadata: { attempt: 1 } }));

    expect(text).toBe("The plan is ready.");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      userId: 7,
      kind: "season_plan",
      provider: "stub",
      model: "openrouter/model",
      messages,
      response: "The plan is ready.",
      error: null,
      durationMs: 7,
    });
    expect(saved[0]?.metadata).toMatchObject({
      attempt: 1,
      temperature: 0.4,
      maxTokens: 1024,
      responseModel: null,
      finishReason: null,
    });
  });

  it("uses the provider's rich completion for usage and routing metadata", async () => {
    const saved: NewLlmCall[] = [];
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
    const wrapped = withPromptLogging(provider, {
      userId: 3,
      save: (call) => {
        saved.push(call);
        return Promise.resolve();
      },
    });

    const text = await wrapped.complete(request());

    expect(text).toBe("Detailed response");
    expect(saved[0]?.usage).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
    });
    expect(saved[0]?.metadata).toMatchObject({
      responseModel: "routed/model",
      finishReason: "stop",
    });
  });

  it("stores failures and rethrows the provider error", async () => {
    const saved: NewLlmCall[] = [];
    const provider: LlmProvider = {
      id: "stub",
      listModels: () => Promise.resolve([]),
      validateKey: () => Promise.resolve(),
      complete: () => Promise.reject(new Error("provider exploded")),
    };
    const wrapped = withPromptLogging(provider, {
      userId: 9,
      save: (call) => {
        saved.push(call);
        return Promise.resolve();
      },
    });

    const error: unknown = await wrapped
      .complete(request())
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("provider exploded");

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      userId: 9,
      kind: "season_plan",
      response: null,
      error: "provider exploded",
      usage: null,
    });
    expect(saved[0]?.messages).toEqual(messages);
  });

  it("does not break the completion when logging fails", async () => {
    const provider = new StubProvider(() => "Still works");
    const wrapped = withPromptLogging(provider, {
      userId: 1,
      save: () => Promise.reject(new Error("database down")),
    });

    expect(await wrapped.complete(request())).toBe("Still works");
  });

  it("logs every retry attempt with its attempt number", async () => {
    const saved: NewLlmCall[] = [];
    let calls = 0;
    const provider = new StubProvider(() => {
      calls += 1;
      if (calls === 1) {
        throw new LlmTokenLimitError("too long");
      }
      return "Recovered";
    });
    const wrapped = withPromptLogging(provider, {
      userId: 5,
      save: (call) => {
        saved.push(call);
        return Promise.resolve();
      },
    });

    const text = await completeWithFallbacks(
      wrapped,
      { apiKey: "test-key", model: "openrouter/model" },
      messages,
      2048,
      0.4,
      { kind: "activity_analysis" },
    );

    expect(text).toBe("Recovered");
    expect(saved).toHaveLength(2);
    expect(saved.map((call) => call.metadata.attempt)).toEqual([1, 2]);
    expect(saved[0]?.error).toBe("too long");
    expect(saved[1]?.response).toBe("Recovered");
    expect(saved.every((call) => call.kind === "activity_analysis")).toBe(true);
  });
});
