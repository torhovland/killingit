import { describe, expect, it } from "bun:test";
import {
  createOpenRouterProvider,
  LlmAuthError,
  LlmProviderError,
  LlmRateLimitError,
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
            ],
          }),
        ),
      ),
    });

    const models = await provider.listModels();
    expect(models).toHaveLength(3);
    expect(models.some((model) => model.id === "image-only")).toBe(false);
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
});
