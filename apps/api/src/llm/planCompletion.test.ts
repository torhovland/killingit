import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  LlmAuthError,
  LlmTokenLimitError,
  type LlmCompletionRequest,
  type LlmProvider,
} from "./openrouter.js";
import { completePlan, completePlanJson } from "./planCompletion.js";
import { PlanJsonError } from "./planJson.js";

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

const resultSchema = z.object({ title: z.string().min(1) });
const credentials = { apiKey: "key", model: "model" };
const messages = [{ role: "user" as const, content: "plan" }];

describe("completePlanJson", () => {
  it("returns a valid response without asking for a repair", async () => {
    const provider = new FakeProvider(['{"title":"Easy run"}']);

    const result = await completePlanJson(
      resultSchema,
      provider,
      credentials,
      messages,
      4096,
    );

    expect(result).toEqual({ title: "Easy run" });
    expect(provider.requests).toHaveLength(1);
  });

  it("asks the model to correct an invalid shape once", async () => {
    const provider = new FakeProvider(['{"title":""}', '{"title":"Easy run"}']);

    const result = await completePlanJson(
      resultSchema,
      provider,
      credentials,
      messages,
      4096,
    );

    expect(result).toEqual({ title: "Easy run" });
    expect(provider.requests).toHaveLength(2);
    const repair = provider.requests[1]?.messages ?? [];
    expect(repair.slice(0, -2)).toEqual(messages);
    expect(repair.at(-2)).toEqual({
      role: "assistant",
      content: '{"title":""}',
    });
    expect(repair.at(-1)?.content).toContain("title");
    expect(repair.at(-1)?.content).toContain("corrected JSON object");
  });

  it("does not retry more than once", async () => {
    const provider = new FakeProvider(['{"title":""}', '{"title":""}']);

    let failure: unknown;
    try {
      await completePlanJson(
        resultSchema,
        provider,
        credentials,
        messages,
        4096,
      );
    } catch (err) {
      failure = err;
    }

    expect(failure).toBeInstanceOf(PlanJsonError);
    expect(provider.requests).toHaveLength(2);
  });
});

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
