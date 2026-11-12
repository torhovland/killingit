import { describe, expect, it } from "bun:test";
import {
  LlmAbortError,
  LlmAuthError,
  LlmProviderError,
  LlmTokenLimitError,
  type LlmCompletionRequest,
  type LlmProvider,
} from "./openrouter.js";
import {
  completeWithFallbacks,
  createCompletionBudget,
} from "./resilientCompletion.js";
import { MAX_COMPLETION_ATTEMPTS } from "./planBudget.js";

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

/** A provider that answers only when its request is aborted. */
class HangingProvider implements LlmProvider {
  readonly id = "hanging";
  readonly requests: LlmCompletionRequest[] = [];

  listModels(): Promise<never[]> {
    return Promise.resolve([]);
  }

  validateKey(): Promise<void> {
    return Promise.resolve();
  }

  complete(request: LlmCompletionRequest): Promise<string> {
    this.requests.push(request);
    return new Promise((_, reject) => {
      request.signal?.addEventListener("abort", () => {
        reject(new LlmAbortError());
      });
    });
  }
}

const credentials = { apiKey: "key", model: "model" };
const messages = [{ role: "user" as const, content: "analyse" }];

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return undefined;
}

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

  it("doubles the budget without a reasoning control on the third attempt", async () => {
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
    expect(provider.requests[2]?.reasoning).toBeUndefined();
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

  it("retries a rejected completion with the small rescue budget", async () => {
    const provider = new FakeProvider([
      new LlmProviderError("max_tokens is too large", 400),
      new LlmProviderError("max_tokens is too large", 400),
      new LlmProviderError("max_tokens is too large", 400),
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
    expect(provider.requests).toHaveLength(4);
    expect(provider.requests[3]?.maxTokens).toBe(4096);
    expect(provider.requests[3]?.reasoning).toBeUndefined();
    expect(provider.requests[3]?.metadata).toMatchObject({
      attempt: 4,
      ofAttempts: 4,
    });
  });

  it("drops reasoning control for models that reject it", async () => {
    const mandatory = new LlmProviderError(
      "Reasoning is mandatory for this endpoint and cannot be disabled.",
      400,
    );
    const provider = new FakeProvider([mandatory, mandatory, "Analysis."]);

    const text = await completeWithFallbacks(
      provider,
      credentials,
      messages,
      2048,
      0.3,
    );

    expect(text).toBe("Analysis.");
    expect(provider.requests).toHaveLength(3);
    expect(provider.requests[2]?.reasoning).toBeUndefined();
    expect(provider.requests[2]?.maxTokens).toBe(4096);
  });

  it("does not retry an auth failure", async () => {
    const provider = new FakeProvider([new LlmAuthError("invalid key")]);

    const failure = await failureOf(
      completeWithFallbacks(provider, credentials, messages, 2048),
    );

    expect(failure).toBeInstanceOf(LlmAuthError);
    expect(provider.requests).toHaveLength(1);
  });

  for (const status of [402, 403, 404, 422, 429]) {
    it(`does not retry a ${status} rejection`, async () => {
      const provider = new FakeProvider([
        new LlmProviderError(`rejected with ${status}`, status),
      ]);

      const failure = await failureOf(
        completeWithFallbacks(provider, credentials, messages, 2048),
      );

      expect(failure).toBeInstanceOf(LlmProviderError);
      expect(provider.requests).toHaveLength(1);
    });
  }

  it("stops at the attempt cap when every attempt is truncated", async () => {
    const provider = new FakeProvider(
      Array.from({ length: 8 }, () => new LlmTokenLimitError("limit")),
    );

    const failure = await failureOf(
      completeWithFallbacks(provider, credentials, messages, 16_384),
    );

    expect(failure).toBeInstanceOf(LlmTokenLimitError);
    expect(provider.requests).toHaveLength(MAX_COMPLETION_ATTEMPTS);
  });

  it("does not start an attempt when no attempt budget is left", async () => {
    const provider = new FakeProvider(["unused"]);

    const failure = await failureOf(
      completeWithFallbacks(provider, credentials, messages, 2048, 0.3, {
        budget: createCompletionBudget({ attempts: 0 }),
      }),
    );

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as Error).message).toContain("kept failing");
    expect(provider.requests).toHaveLength(0);
  });

  it("does not start an attempt after the wall-clock budget has passed", async () => {
    const provider = new FakeProvider(["unused"]);

    const failure = await failureOf(
      completeWithFallbacks(provider, credentials, messages, 2048, 0.3, {
        budget: createCompletionBudget({ budgetMs: 0 }),
      }),
    );

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as Error).message).toContain("ran out of time");
    expect(provider.requests).toHaveLength(0);
  });

  it("aborts an attempt that outlives the wall-clock budget", async () => {
    const provider = new HangingProvider();

    const failure = await failureOf(
      completeWithFallbacks(provider, credentials, messages, 2048, 0.3, {
        budget: createCompletionBudget({ budgetMs: 25 }),
      }),
    );

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as Error).message).toContain("ran out of time");
    expect(provider.requests).toHaveLength(1);
  });

  it("stops immediately when the run has already been aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new FakeProvider(["unused"]);

    const failure = await failureOf(
      completeWithFallbacks(
        provider,
        { ...credentials, signal: controller.signal },
        messages,
        2048,
      ),
    );

    expect(failure).toBeInstanceOf(LlmAbortError);
    expect(provider.requests).toHaveLength(0);
  });

  it("cancels the provider request when the run is cancelled", async () => {
    const controller = new AbortController();
    const provider = new FakeProvider(["Analysis."]);

    await completeWithFallbacks(
      provider,
      { ...credentials, signal: controller.signal },
      messages,
      2048,
    );

    const signal = provider.requests[0]?.signal;
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });
});
