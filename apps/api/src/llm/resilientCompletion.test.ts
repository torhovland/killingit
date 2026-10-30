import { describe, expect, it } from "bun:test";
import {
  LlmAbortError,
  LlmAuthError,
  LlmProviderError,
  LlmTokenLimitError,
  type LlmCompletionRequest,
  type LlmProvider,
} from "./openrouter.js";
import { completeWithFallbacks } from "./resilientCompletion.js";

class FakeProvider implements LlmProvider {
  readonly id = "fake";
  readonly requests: LlmCompletionRequest[] = [];

  constructor(private readonly outcomes: Array<string | Error>) {}

  listModels(): Promise<never[]> {
    return Promise.resolve([]);
  }

  validateKey(): Promise<void> {
    return Promise.resolve();
  }

  complete(request: LlmCompletionRequest): Promise<string> {
    this.requests.push(request);
    const outcome = this.outcomes[this.requests.length - 1];
    if (outcome instanceof Error) {
      return Promise.reject(outcome);
    }
    return Promise.resolve(outcome ?? "");
  }
}

const credentials = { apiKey: "key", model: "model" };
const messages = [{ role: "user" as const, content: "analyse" }];

describe("completeWithFallbacks", () => {
  it("retries with reasoning disabled when the budget is exhausted", async () => {
    const provider = new FakeProvider([
      new LlmTokenLimitError("limit"),
      "Analysis.",
    ]);

    const text = await completeWithFallbacks(
      provider,
      credentials,
      messages,
      2048,
      0.3,
    );

    expect(text).toBe("Analysis.");
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.reasoning).toEqual({ effort: "minimal" });
    expect(provider.requests[1]?.reasoning).toEqual({ effort: "none" });
    expect(provider.requests[1]?.maxTokens).toBe(2048);
  });

  it("doubles the budget on the third attempt", async () => {
    const provider = new FakeProvider([
      new LlmTokenLimitError("limit"),
      new LlmTokenLimitError("limit"),
      "Analysis.",
    ]);

    const text = await completeWithFallbacks(
      provider,
      credentials,
      messages,
      2048,
      0.3,
    );

    expect(text).toBe("Analysis.");
    expect(provider.requests[2]?.reasoning).toEqual({ effort: "none" });
    expect(provider.requests[2]?.maxTokens).toBe(4096);
  });

  it("caps the doubled budget at MAX_COMPLETION_TOKENS", async () => {
    const provider = new FakeProvider([
      new LlmTokenLimitError("limit"),
      new LlmTokenLimitError("limit"),
      "Analysis.",
    ]);

    const text = await completeWithFallbacks(
      provider,
      credentials,
      messages,
      16_384,
      0.3,
    );

    expect(text).toBe("Analysis.");
    expect(provider.requests[2]?.maxTokens).toBe(32_768);
  });

  it("retries with a small budget for providers that reject a large one", async () => {
    const provider = new FakeProvider([
      new LlmProviderError("max_tokens too large", 400),
      new LlmProviderError("max_tokens too large", 400),
      new LlmProviderError("max_tokens too large", 400),
      new LlmProviderError("max_tokens too large", 400),
      "Analysis.",
    ]);

    const text = await completeWithFallbacks(
      provider,
      credentials,
      messages,
      16_384,
      0.3,
    );

    expect(text).toBe("Analysis.");
    expect(provider.requests[4]?.maxTokens).toBe(4096);
  });

  it("drops reasoning control for models that reject it", async () => {
    const provider = new FakeProvider([
      new LlmProviderError("unsupported reasoning", 400),
      new LlmProviderError("unsupported reasoning", 400),
      new LlmProviderError("unsupported reasoning", 400),
      "Analysis.",
    ]);

    const text = await completeWithFallbacks(
      provider,
      credentials,
      messages,
      2048,
      0.3,
    );

    expect(text).toBe("Analysis.");
    expect(provider.requests[3]?.reasoning).toBeUndefined();
    expect(provider.requests[3]?.maxTokens).toBe(4096);
  });

  it("does not retry an auth failure", async () => {
    const provider = new FakeProvider([new LlmAuthError("invalid key")]);

    let failure: unknown;
    try {
      await completeWithFallbacks(provider, credentials, messages, 2048);
    } catch (err) {
      failure = err;
    }

    expect(failure).toBeInstanceOf(LlmAuthError);
    expect(provider.requests).toHaveLength(1);
  });

  it("throws the last error when every attempt is truncated", async () => {
    const provider = new FakeProvider([
      new LlmTokenLimitError("limit"),
      new LlmTokenLimitError("limit"),
      new LlmTokenLimitError("limit"),
      new LlmTokenLimitError("limit"),
      new LlmTokenLimitError("limit"),
    ]);

    let failure: unknown;
    try {
      await completeWithFallbacks(provider, credentials, messages, 2048);
    } catch (err) {
      failure = err;
    }

    expect(failure).toBeInstanceOf(LlmTokenLimitError);
    expect(provider.requests).toHaveLength(5);
  });

  it("stops immediately when the run has already been aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new FakeProvider(["unused"]);

    let failure: unknown;
    try {
      await completeWithFallbacks(
        provider,
        { ...credentials, signal: controller.signal },
        messages,
        2048,
      );
    } catch (err) {
      failure = err;
    }

    expect(failure).toBeInstanceOf(LlmAbortError);
    expect(provider.requests).toHaveLength(0);
  });

  it("passes the run's abort signal to the provider", async () => {
    const controller = new AbortController();
    const provider = new FakeProvider(["Analysis."]);

    await completeWithFallbacks(
      provider,
      { ...credentials, signal: controller.signal },
      messages,
      2048,
    );

    expect(provider.requests[0]?.signal).toBe(controller.signal);
  });
});
