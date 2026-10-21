import { llmModelSchema, type LlmModel } from "@killingit/shared";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
// Plan generation uses slow reasoning models and a multi-step cascade. Keep
// this below the Bun server idle timeout (255s) but well above a single
// completion's typical latency.
const REQUEST_TIMEOUT_MS = 240_000;
const KEY_CHECK_TIMEOUT_MS = 15_000;

/** Raised when the LLM provider rejects or cannot serve a request. */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LlmProviderError";
  }
}

/** Raised specifically for an invalid/revoked API key (mapped to 401). */
export class LlmAuthError extends LlmProviderError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 401, options);
    this.name = "LlmAuthError";
  }
}

/** Raised when the provider rate-limits a request or hits a daily quota (429). */
export class LlmRateLimitError extends LlmProviderError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 429, options);
    this.name = "LlmRateLimitError";
  }
}

/** Raised when the provider stops at the requested output-token limit. */
export class LlmTokenLimitError extends LlmProviderError {
  constructor(message: string) {
    super(message);
    this.name = "LlmTokenLimitError";
  }
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * OpenRouter's normalized reasoning controls. Reasoning tokens count against
 * `maxTokens`, so `minimal` is appropriate for structured JSON generations.
 */
export interface LlmReasoning {
  effort?: "minimal" | "low" | "medium" | "high" | "none";
  /** Direct reasoning-token cap for Anthropic/Gemini/Qwen-style models. */
  max_tokens?: number;
  /** Hide the reasoning text from the response; it still counts as output. */
  exclude?: boolean;
}

export interface LlmCompletionRequest {
  apiKey: string;
  model: string;
  messages: LlmMessage[];
  temperature: number;
  maxTokens: number;
  reasoning?: LlmReasoning;
}

/**
 * Provider-agnostic LLM seam (AGENTS.md). Only OpenRouter implements it today;
 * another provider can be swapped in without touching the coaching route.
 */
export interface LlmProvider {
  readonly id: string;
  listModels(): Promise<LlmModel[]>;
  validateKey(apiKey: string): Promise<void>;
  complete(request: LlmCompletionRequest): Promise<string>;
}

export interface OpenRouterOptions {
  /** Injectable fetch for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Override the API base URL (defaults to `OPENROUTER_API_URL` or OpenRouter). */
  baseUrl?: string;
}

/** Creates the OpenRouter implementation of the LLM provider seam. */
export function createOpenRouterProvider(
  options: OpenRouterOptions = {},
): LlmProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (
    options.baseUrl ??
    process.env.OPENROUTER_API_URL ??
    DEFAULT_BASE_URL
  ).replace(/\/$/, "");

  return {
    id: "openrouter",

    async listModels() {
      const res = await request(
        fetchImpl,
        `${baseUrl}/models`,
        { signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS) },
        "could not reach OpenRouter for the model list",
      );
      if (!res.ok) {
        throw new LlmProviderError(
          await providerDetail(res, `OpenRouter returned ${res.status}`),
          res.status,
        );
      }

      const body = (await res.json()) as { data?: unknown };
      if (!Array.isArray(body.data)) {
        throw new LlmProviderError(
          "OpenRouter returned a malformed model list",
        );
      }

      return body.data
        .map(normalizeModel)
        .filter((model): model is LlmModel => model !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async validateKey(apiKey) {
      const res = await request(
        fetchImpl,
        `${baseUrl}/key`,
        {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
        },
        "could not reach OpenRouter to validate the API key",
      );
      if (res.status === 401) {
        throw new LlmAuthError("invalid OpenRouter API key");
      }
      if (!res.ok) {
        throw new LlmProviderError(
          await providerDetail(
            res,
            `OpenRouter key check returned ${res.status}`,
          ),
          res.status,
        );
      }
      // Drain the body so the connection can be reused.
      await res.text();
    },

    async complete(input) {
      const res = await request(
        fetchImpl,
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${input.apiKey}`,
            "content-type": "application/json",
            "HTTP-Referer": "https://killingit.hovland.co",
            "X-Title": "Killing It",
          },
          body: JSON.stringify({
            model: input.model,
            messages: input.messages,
            temperature: input.temperature,
            max_tokens: input.maxTokens,
            ...(input.reasoning !== undefined
              ? { reasoning: input.reasoning }
              : {}),
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
        "could not reach OpenRouter for the completion",
      );

      if (res.status === 401) {
        throw new LlmAuthError("invalid OpenRouter API key");
      }
      if (res.status === 402) {
        throw new LlmProviderError(
          "OpenRouter account has insufficient credits",
          402,
        );
      }
      if (res.status === 429) {
        const detail = await providerDetail(res, "OpenRouter rate limit");
        throw new LlmRateLimitError(
          `${detail} This may be a per-minute rate limit or a free-model daily request cap that is separate from your credit balance. Wait a few minutes and retry, or switch to a paid model.`,
        );
      }
      if (!res.ok) {
        throw new LlmProviderError(
          await providerDetail(
            res,
            `OpenRouter completion returned ${res.status}`,
          ),
          res.status,
        );
      }

      const body = (await res.json()) as {
        choices?: Array<{
          message?: { content?: unknown };
          finish_reason?: unknown;
        }>;
      };
      const choice = body.choices?.[0];
      if (choice?.finish_reason === "length") {
        throw new LlmTokenLimitError(
          "OpenRouter stopped the response at the token limit; try again or choose a model with a larger output budget",
        );
      }
      const content = choice?.message?.content;
      if (typeof content !== "string" || content.trim() === "") {
        throw new LlmProviderError("OpenRouter returned an empty completion");
      }
      return content.trim();
    },
  };
}

/** Performs a fetch, converting transport failures into provider errors. */
async function request(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  unreachableMessage: string,
): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (cause) {
    throw new LlmProviderError(unreachableMessage, undefined, { cause });
  }
}

/** Normalizes one OpenRouter model entry, or null when it is malformed. */
function normalizeModel(raw: unknown): LlmModel | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const entry = raw as {
    id?: unknown;
    name?: unknown;
    context_length?: unknown;
    pricing?: { prompt?: unknown; completion?: unknown };
    architecture?: { output_modalities?: unknown };
  };
  if (typeof entry.id !== "string" || entry.id === "") {
    return null;
  }

  // Coaching needs a text-in/text-out model. Keep entries with no modality
  // metadata (older/partial payloads) so the picker remains useful.
  const outputs = entry.architecture?.output_modalities;
  if (Array.isArray(outputs) && !outputs.includes("text")) {
    return null;
  }

  const parsed = llmModelSchema.safeParse({
    id: entry.id,
    name:
      typeof entry.name === "string" && entry.name !== ""
        ? entry.name
        : entry.id,
    contextLength:
      typeof entry.context_length === "number" ? entry.context_length : null,
    promptPricePerMillion: pricePerMillion(entry.pricing?.prompt),
    completionPricePerMillion: pricePerMillion(entry.pricing?.completion),
  });
  return parsed.success ? parsed.data : null;
}

/** Converts an OpenRouter per-token price string to USD per million tokens. */
function pricePerMillion(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") {
    return null;
  }
  const value = Number(raw);
  // OpenRouter uses negative sentinel values (e.g. -1 for routed pricing).
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value * 1_000_000 * 100) / 100;
}

/** Reads the provider's error message, falling back to a safe summary. */
async function providerDetail(
  res: Response,
  fallback: string,
): Promise<string> {
  const text = await res.text();
  if (!text) {
    return fallback;
  }
  try {
    const body = JSON.parse(text) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    if (typeof body.error === "string" && body.error !== "") {
      return body.error;
    }
    if (
      typeof body.error === "object" &&
      body.error !== null &&
      typeof body.error.message === "string" &&
      body.error.message !== ""
    ) {
      return body.error.message;
    }
    if (typeof body.message === "string" && body.message !== "") {
      return body.message;
    }
  } catch {
    return text.length <= 300 ? text : fallback;
  }
  return fallback;
}
