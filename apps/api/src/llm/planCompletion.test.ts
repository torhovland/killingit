import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  LlmProviderError,
  LlmTokenLimitError,
  type LlmCompletionRequest,
  type LlmProvider,
} from "./openrouter.js";
import { completePlanJson } from "./planCompletion.js";
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

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return undefined;
}

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

  it("requests minimal reasoning and retries with it disabled at the token limit", async () => {
    const provider = new FakeProvider([
      new LlmTokenLimitError("limit"),
      '{"title":"Easy run"}',
    ]);

    const result = await completePlanJson(
      resultSchema,
      provider,
      credentials,
      messages,
      4096,
    );

    expect(result).toEqual({ title: "Easy run" });
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.reasoning).toEqual({ effort: "minimal" });
    expect(provider.requests[0]?.maxTokens).toBe(4096);
    expect(provider.requests[1]?.reasoning).toEqual({ effort: "none" });
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
    expect(repair.at(-1)?.content).toContain(
      'for every type field use either "workout" or "rest"',
    );
    expect(repair.at(-1)?.content).toContain(
      "The top-level object must contain every key named at the top level of the contract",
    );
  });

  it("includes a caller's repair hint in the corrective turn", async () => {
    const provider = new FakeProvider(['{"title":""}', '{"title":"Easy run"}']);

    await completePlanJson(
      resultSchema,
      provider,
      credentials,
      messages,
      4096,
      {
        repairHint:
          "The week must start on 2026-10-19 and today's date must be 2026-10-21.",
      },
    );

    expect(provider.requests[1]?.messages.at(-1)?.content).toContain(
      "The week must start on 2026-10-19 and today's date must be 2026-10-21.",
    );
  });

  it("does not retry more than once without a system contract", async () => {
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

  it("keeps only the system contract in the compact repair", async () => {
    const system = { role: "system" as const, content: "contract" };
    const user = { role: "user" as const, content: "a large plan context" };
    const provider = new FakeProvider(['{"title":""}', '{"title":"Easy run"}']);

    const result = await completePlanJson(
      resultSchema,
      provider,
      credentials,
      [system, user],
      4096,
    );

    expect(result).toEqual({ title: "Easy run" });
    const repair = provider.requests[1]?.messages ?? [];
    expect(repair).toHaveLength(3);
    expect(repair[0]).toEqual(system);
    expect(repair[1]).toEqual({ role: "assistant", content: '{"title":""}' });
    expect(repair[2]?.role).toBe("user");
    expect(repair[2]?.content).toContain("corrected JSON object");
    expect(repair).not.toContainEqual(user);
    expect(provider.requests[1]?.metadata).toMatchObject({
      repair: true,
      repairContext: "compact",
    });
  });

  it("falls back to the full context when the compact repair fails", async () => {
    const system = { role: "system" as const, content: "contract" };
    const user = { role: "user" as const, content: "a large plan context" };
    const provider = new FakeProvider([
      '{"title":""}',
      '{"title":""}',
      '{"title":"Easy run"}',
    ]);

    const result = await completePlanJson(
      resultSchema,
      provider,
      credentials,
      [system, user],
      4096,
    );

    expect(result).toEqual({ title: "Easy run" });
    expect(provider.requests).toHaveLength(3);
    expect(provider.requests[2]?.messages).toContainEqual(user);
    expect(provider.requests[2]?.metadata).toMatchObject({
      repair: true,
      repairContext: "full",
      repairAttempt: 2,
    });
  });

  it("stops billing after the plan level's completion budget", async () => {
    const system = { role: "system" as const, content: "contract" };
    const user = { role: "user" as const, content: "a large plan context" };
    const provider = new FakeProvider([
      '{"title":""}',
      new LlmTokenLimitError("limit"),
      new LlmTokenLimitError("limit"),
      new LlmTokenLimitError("limit"),
      '{"title":""}',
      new LlmTokenLimitError("limit"),
      '{"title":"Easy run"}',
    ]);

    const failure = await failureOf(
      completePlanJson(
        resultSchema,
        provider,
        credentials,
        [system, user],
        16_384,
      ),
    );

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as Error).message).toContain("kept failing");
    expect(provider.requests).toHaveLength(6);
  });
});
