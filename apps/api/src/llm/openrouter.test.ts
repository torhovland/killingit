import { describe, expect, it } from "bun:test";
import {
  createOpenRouterProvider,
  LlmAbortError,
  LlmAuthError,
  LlmProviderError,
  LlmRateLimitError,
  LlmTokenLimitError,
} from "./openrouter.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    const href =
      typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    return handler(href, init);
  }) as typeof fetch;
}

/** Asserts that a promise rejects with the given error type. */
async function expectRejectsWith(
  promise: Promise<unknown>,
  type: new (...args: never[]) => Error,
): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(type);
    return;
  }
  throw new Error("expected promise to reject");
}

describe("listModels", () => {
  it("normalizes OpenRouter models and prices", async () => {
    const provider = createOpenRouterProvider({
      baseUrl: "https://example.test/api/v1",
      fetchImpl: stubFetch(() =>
        Promise.resolve(
          jsonResponse({
            data: [
              {
                id: "openrouter/auto",
                name: "Auto Router",
                context_length: 200000,
                pricing: { prompt: "0.000001", completion: "0.000002" },
                architecture: { output_modalities: ["text"] },
              },
              { id: "broken" },
              {
                id: "image-only",
                name: "Image Only",
                architecture: { output_modalities: ["image"] },
              },
              { id: "routed", name: "Routed", pricing: { prompt: "-1" } },
              { id: "openai/gpt-5:batch", name: "Batch Only" },
            ],
          }),
        ),
      ),
    });

    const models = await provider.listModels();
    expect(models).toHaveLength(3);
    expect(models.some((model) => model.id === "image-only")).toBe(false);
    expect(models.some((model) => model.id === "openai/gpt-5:batch")).toBe(
      false,
    );
    expect(
      models.find((model) => model.id === "openrouter/auto"),
    ).toMatchObject({
      name: "Auto Router",
      contextLength: 200000,
      promptPricePerMillion: 1,
      completionPricePerMillion: 2,
    });
    expect(models.find((model) => model.id === "broken")?.name).toBe("broken");
    expect(models.find((model) => model.id === "routed")).toMatchObject({
      promptPricePerMillion: null,
      completionPricePerMillion: null,
    });
  });

  it("throws a provider error for a malformed payload", async () => {
    const provider = createOpenRouterProvider({
      fetchImpl: stubFetch(() =>
        Promise.resolve(jsonResponse({ data: "nope" })),
      ),
    });
    await expectRejectsWith(provider.listModels(), LlmProviderError);
  });
});

describe("validateKey", () => {
  it("sends the key and resolves on success", async () => {
    const captured: Array<string | null> = [];
    const provider = createOpenRouterProvider({
      baseUrl: "https://example.test/api/v1",
      fetchImpl: stubFetch((_url, init) => {
        captured.push(new Headers(init?.headers).get("authorization"));
        return Promise.resolve(jsonResponse({ data: { label: "ok" } }));
      }),
    });

    await provider.validateKey("sk-or-v1-test");
    expect(captured[0]).toBe("Bearer sk-or-v1-test");
  });

  it("maps a 401 to LlmAuthError", async () => {
    const provider = createOpenRouterProvider({
      fetchImpl: stubFetch(() =>
        Promise.resolve(jsonResponse({ error: { message: "no" } }, 401)),
      ),
    });
    await expectRejectsWith(provider.validateKey("bad"), LlmAuthError);
  });
});

describe("complete", () => {
  it("returns the assistant message content", async () => {
    let body: unknown;
    const provider = createOpenRouterProvider({
      baseUrl: "https://example.test/api/v1",
      fetchImpl: stubFetch((_url, init) => {
        body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        return Promise.resolve(
          jsonResponse({
            choices: [{ message: { content: "  Solid aerobic effort.  " } }],
          }),
        );
      }),
    });

    const text = await provider.complete({
      apiKey: "sk-or-v1-test",
      model: "openrouter/auto",
      messages: [{ role: "user", content: "analyse" }],
      temperature: 0.3,
      maxTokens: 500,
    });

    expect(text).toBe("Solid aerobic effort.");
    expect(body).toMatchObject({
      model: "openrouter/auto",
      messages: [{ role: "user", content: "analyse" }],
      temperature: 0.3,
      max_tokens: 500,
    });
  });

  it("returns routing and usage details from completeDetailed", async () => {
    const provider = createOpenRouterProvider({
      baseUrl: "https://example.test/api/v1",
      fetchImpl: stubFetch(() =>
        Promise.resolve(
          jsonResponse({
            model: "anthropic/claude-test",
            usage: {
              prompt_tokens: 120,
              completion_tokens: 30,
              total_tokens: 150,
              cost: 0.0012,
            },
            choices: [
              { message: { content: "Plan ready." }, finish_reason: "stop" },
            ],
          }),
        ),
      ),
    });
    const result = await provider.completeDetailed?.({
      apiKey: "sk-or-v1-test",
      model: "openrouter/auto",
      messages: [{ role: "user", content: "analyse" }],
      temperature: 0.3,
      maxTokens: 500,
    });
    if (result === undefined) {
      throw new Error("expected completeDetailed to be implemented");
    }

    expect(result).toEqual({
      text: "Plan ready.",
      model: "anthropic/claude-test",
      finishReason: "stop",
      usage: {
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
        costUsd: 0.0012,
      },
    });
  });

  it("surfaces insufficient credits distinctly", async () => {
    const provider = createOpenRouterProvider({
      fetchImpl: stubFetch(() =>
        Promise.resolve(jsonResponse({ error: { message: "credits" } }, 402)),
      ),
    });
    try {
      await provider.complete({
        apiKey: "sk-or-v1-test",
        model: "openrouter/auto",
        messages: [{ role: "user", content: "analyse" }],
        temperature: 0.3,
        maxTokens: 500,
      });
      throw new Error("expected completion to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(LlmProviderError);
      expect((err as LlmProviderError).status).toBe(402);
    }
  });

  it("maps a 429 to LlmRateLimitError with quota guidance", async () => {
    const provider = createOpenRouterProvider({
      fetchImpl: stubFetch(() =>
        Promise.resolve(
          jsonResponse(
            { error: { message: "Daily limit exceeded for free model" } },
            429,
          ),
        ),
      ),
    });
    try {
      await provider.complete({
        apiKey: "sk-or-v1-test",
        model: "openrouter/free",
        messages: [{ role: "user", content: "analyse" }],
        temperature: 0.3,
        maxTokens: 500,
      });
      throw new Error("expected completion to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(LlmRateLimitError);
      expect((err as LlmRateLimitError).status).toBe(429);
      expect((err as Error).message).toContain("Daily limit exceeded");
      expect((err as Error).message).toContain("free-model daily request cap");
    }
  });

  it("rejects a completion truncated at the token limit", async () => {
    const provider = createOpenRouterProvider({
      fetchImpl: stubFetch(() =>
        Promise.resolve(
          jsonResponse({
            choices: [
              {
                message: { content: "You climbed in two main eff" },
                finish_reason: "length",
              },
            ],
          }),
        ),
      ),
    });

    await expectRejectsWith(
      provider.complete({
        apiKey: "sk-or-v1-test",
        model: "openrouter/auto",
        messages: [{ role: "user", content: "analyse" }],
        temperature: 0.3,
        maxTokens: 2048,
      }),
      LlmProviderError,
    );
  });

  it("carries the billed usage of a truncated response on the error", async () => {
    const provider = createOpenRouterProvider({
      baseUrl: "https://example.test/api/v1",
      fetchImpl: stubFetch(() =>
        Promise.resolve(
          jsonResponse({
            model: "anthropic/claude-test",
            usage: {
              prompt_tokens: 4_000,
              completion_tokens: 2_048,
              total_tokens: 6_048,
              cost: 0.0123,
            },
            choices: [
              {
                message: { content: "You climbed in two main eff" },
                finish_reason: "length",
              },
            ],
          }),
        ),
      ),
    });

    try {
      await provider.complete({
        apiKey: "sk-or-v1-test",
        model: "openrouter/auto",
        messages: [{ role: "user", content: "analyse" }],
        temperature: 0.3,
        maxTokens: 2048,
      });
      throw new Error("expected completion to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(LlmTokenLimitError);
      expect((err as LlmTokenLimitError).usage).toEqual({
        promptTokens: 4_000,
        completionTokens: 2_048,
        totalTokens: 6_048,
        costUsd: 0.0123,
      });
      expect((err as LlmTokenLimitError).model).toBe("anthropic/claude-test");
      expect((err as LlmTokenLimitError).finishReason).toBe("length");
    }
  });

  it("rejects an empty completion", async () => {
    const provider = createOpenRouterProvider({
      fetchImpl: stubFetch(() =>
        Promise.resolve(
          jsonResponse({ choices: [{ message: { content: " " } }] }),
        ),
      ),
    });
    await expectRejectsWith(
      provider.complete({
        apiKey: "sk-or-v1-test",
        model: "openrouter/auto",
        messages: [{ role: "user", content: "analyse" }],
        temperature: 0.3,
        maxTokens: 500,
      }),
      LlmProviderError,
    );
  });

  it("maps an aborted request to LlmAbortError", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createOpenRouterProvider({
      fetchImpl: stubFetch(() =>
        Promise.reject(new DOMException("aborted", "AbortError")),
      ),
    });

    await expectRejectsWith(
      provider.complete({
        apiKey: "sk-or-v1-test",
        model: "openrouter/auto",
        messages: [{ role: "user", content: "analyse" }],
        temperature: 0.3,
        maxTokens: 500,
        signal: controller.signal,
      }),
      LlmAbortError,
    );
  });
});

describe("error classes", () => {
  it("reports a rejected key as a fixable connection failure", () => {
    const err = new LlmAuthError("invalid OpenRouter API key");
    expect(err.status).toBe(422);
    expect(err.code).toBe("llm_key_invalid");
  });
});
