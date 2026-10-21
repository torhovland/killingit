import { describe, expect, it } from "bun:test";
import {
  LlmAuthError,
  LlmTokenLimitError,
  type LlmCompletionRequest,
  type LlmProvider,
} from "./openrouter.js";
import { completePlan } from "./planCompletion.js";

class FakeProvider implements LlmProvider {
  readonly id = "fake";
  requests: LlmCompletionRequest[] = [];

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

describe("completePlan", () => {
  it("uses minimal reasoning and retries with a larger budget", async () => {
    const provider = new FakeProvider([
      new LlmTokenLimitError("limit"),
      '{"ok":true}',
    ]);

    const text = await completePlan(
      provider,
      { apiKey: "key", model: "model" },
      [{ role: "user", content: "plan" }],
      4096,
    );

    expect(text).toBe('{"ok":true}');
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.reasoning).toEqual({ effort: "minimal" });
    expect(provider.requests[0]?.maxTokens).toBe(4096);
    expect(provider.requests[1]?.reasoning).toEqual({ effort: "none" });
    expect(provider.requests[1]?.maxTokens).toBe(4096);
  });

  it("does not retry an auth failure", async () => {
    const provider = new FakeProvider([new LlmAuthError("invalid key")]);

    let failure: unknown;
    try {
      await completePlan(
        provider,
        { apiKey: "key", model: "model" },
        [{ role: "user", content: "plan" }],
        4096,
      );
    } catch (err) {
      failure = err;
    }

    expect(failure).toBeInstanceOf(LlmAuthError);
    expect(provider.requests).toHaveLength(1);
  });
});
