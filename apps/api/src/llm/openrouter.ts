import {
  llmModelSchema,
  type ApiErrorCode,
  type LlmCallMetadata,
  type LlmCallUsage,
  type LlmModel,
  type LlmPromptKind,
} from "@killingit/shared";
import { UpstreamError } from "../http/errors.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
// Plan generation uses slow reasoning models and a multi-step cascade. Keep
// this below the Bun server idle timeout (255s) but well above a single
// completion's typical latency.
const REQUEST_TIMEOUT_MS = 240_000;
const KEY_CHECK_TIMEOUT_MS = 15_000;

/**
 * Raised when the LLM provider rejects or cannot serve a request. A failure
 * that carries no status of its own is reported as unavailable.
 */
export class LlmProviderError extends UpstreamError {
  constructor(
    message: string,
    status?: number,
    options?: { code?: ApiErrorCode; cause?: unknown },
  ) {
    super(message, { status, ...options });
    this.name = "LlmProviderError";
  }
}

/**
 * Raised specifically for an invalid or revoked API key. The athlete fixes it
 * in Settings, so it is a `422` with `llm_key_invalid` rather than a `401` the
 * client would retry. See ADR 0036.
 */
export class LlmAuthError extends LlmProviderError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 422, { code: "llm_key_invalid", ...options });
    this.name = "LlmAuthError";
  }
}

/** What OpenRouter reported for a response it stopped at the token limit. */
export interface LlmTokenLimitDetails {
  /** The model OpenRouter actually routed to, when it reports one. */
  model?: string | null;
  finishReason?: string | null;
  usage?: LlmCallUsage | null;
}

/**
 * Raised when the provider stops at the requested output-token limit. The
 * response is billed even though it produced no usable answer, so the usage and
 * routing details are attached for the prompt log and the cost report.
 */
export class LlmTokenLimitError extends LlmProviderError {
  readonly model: string | null;
  readonly finishReason: string | null;
  readonly usage: LlmCallUsage | null;

  constructor(message: string, details: LlmTokenLimitDetails = {}) {
    super(message);
    this.name = "LlmTokenLimitError";
    this.model = details.model ?? null;
    this.finishReason = details.finishReason ?? null;
    this.usage = details.usage ?? null;
  }
}

/** Raised when the caller aborts a completion because a newer run started. */
export class LlmAbortError extends LlmProviderError {
  constructor(
    message = "the completion was cancelled",
    options?: { cause?: unknown },
  ) {
    super(message, undefined, options);
    this.name = "LlmAbortError";
  }
}

/** True when an error came from an aborted provider request. */
export function isLlmAbortError(err: unknown): err is LlmAbortError {
  return (
    err instanceof LlmAbortError ||
    (err instanceof Error && err.name === "AbortError")
  );
}

/** One part of a multimodal message. Text-only prompts use a plain string. */
export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/**
 * One message in a provider conversation. It is wider than the prompt
 * `LlmMessage` in `promptRules.ts`: a repair adds an assistant turn, and a meal
 * analysis attaches an image part. Every prompt message is assignable to it.
 */
export interface LlmProviderMessage {
  role: "system" | "user" | "assistant";
  content: string | LlmContentPart[];
}

/** The text of a message, ignoring any attached images. */
export function llmMessageText(content: string | LlmContentPart[]): string {
  return typeof content === "string"
    ? content
    : content
        .filter(
          (part): part is { type: "text"; text: string } =>
            part.type === "text",
        )
        .map((part) => part.text)
        .join("\n");
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
  messages: LlmProviderMessage[];
  temperature: number;
  maxTokens: number;
  reasoning?: LlmReasoning | undefined;
  /** The coaching task this prompt belongs to, recorded in the prompt log. */
  kind?: LlmPromptKind | undefined;
  /**
   * Extra debug metadata for the prompt log (retry attempt, repair turn).
   * Never sent to the provider.
   */
  metadata?: LlmCallMetadata;
  /** Cancels this request; it is combined with the provider timeout. */
  signal?: AbortSignal;
}

/** The normalised result of one completion, including provider diagnostics. */
export interface LlmCompletionResult {
  text: string;
  /** The model OpenRouter actually routed to, when it reports one. */
  model: string | null;
  finishReason: string | null;
  usage: LlmCallUsage | null;
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
  /**
   * Optional richer completion used by the prompt log. Providers that implement
   * it also return usage and routing details; `complete` remains the minimal
   * contract so simple providers and test doubles stay valid.
   */
  completeDetailed?(
    request: LlmCompletionRequest,
  ): Promise<LlmCompletionResult>;
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

  const completeDetailed = async (
    input: LlmCompletionRequest,
  ): Promise<LlmCompletionResult> => {
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
          reasoning: input.reasoning,
        }),
        signal: requestSignal(input.signal, REQUEST_TIMEOUT_MS),
      },
      "could not reach OpenRouter for the completion",
    );

    await throwForStatus(res, "OpenRouter completion");

    const body = (await res.json()) as {
      model?: unknown;
      usage?: OpenRouterUsage;
      choices?: Array<{
        message?: { content?: unknown };
        finish_reason?: unknown;
      }>;
    };
    const choice = body.choices?.[0];
    const finishReason =
      typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
    const model = typeof body.model === "string" ? body.model : null;
    const usage = normalizeUsage(body.usage);
    if (finishReason === "length") {
      throw new LlmTokenLimitError(
        "OpenRouter stopped the response at the token limit; try again or choose a model with a larger output budget",
        { model, finishReason, usage },
      );
    }
    const content = choice?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new LlmProviderError("OpenRouter returned an empty completion");
    }
    return {
      text: content.trim(),
      model,
      finishReason,
      usage,
    };
  };

  return {
    id: "openrouter",

    async listModels() {
      const res = await request(
        fetchImpl,
        `${baseUrl}/models`,
        { signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS) },
        "could not reach OpenRouter for the model list",
      );
      await throwForStatus(res, "OpenRouter");

      const body = (await res.json()) as { data?: unknown };
      if (!Array.isArray(body.data)) {
        throw new LlmProviderError(
          "OpenRouter returned a malformed model list",
        );
      }

      return (
        body.data
          .map(normalizeModel)
          .filter((model): model is LlmModel => model !== null)
          // Batch-only routes are asynchronous and cannot serve normal chat
          // requests, so they never belong in the model picker.
          .filter((model) => !model.id.endsWith(":batch"))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
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
      await throwForStatus(res, "OpenRouter key check");
      // Drain the body so the connection can be reused.
      await res.text();
    },

    complete: async (input) => (await completeDetailed(input)).text,
    completeDetailed,
  };
}

/**
 * Combines the caller's cancellation with the provider timeout. Aborting is
 * best-effort: OpenRouter has no cancel endpoint, so the socket may close while
 * the upstream model is still finishing.
 */
function requestSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
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
    if (isLlmAbortError(cause) || init.signal?.aborted === true) {
      throw new LlmAbortError("the provider request was cancelled", { cause });
    }
    throw new LlmProviderError(unreachableMessage, undefined, { cause });
  }
}

/**
 * Maps a provider failure status to the error the API reports. A `401` is the
 * athlete's key, not the caller's session, so it becomes the `422` they fix in
 * Settings (ADR 0036). Every other failure keeps the provider's status and
 * message, with the rate-limit guidance attached to a `429`.
 */
async function throwForStatus(res: Response, label: string): Promise<void> {
  if (res.ok) {
    return;
  }
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
    throw new LlmProviderError(
      `${detail} This may be a per-minute rate limit or a free-model daily request cap that is separate from your credit balance. Wait a few minutes and retry, or switch to a paid model.`,
      429,
    );
  }
  throw new LlmProviderError(
    await providerDetail(res, `${label} returned ${res.status}`),
    res.status,
  );
}

/** Token usage as OpenRouter reports it, before normalization. */
interface OpenRouterUsage {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  prompt_tokens_details?: unknown;
  completion_tokens_details?: unknown;
  cost?: unknown;
}

/** Normalizes OpenRouter's token usage, or null when it reports none. */
function normalizeUsage(raw: OpenRouterUsage | undefined): LlmCallUsage | null {
  if (raw === undefined) {
    return null;
  }
  const promptTokens = tokenCount(raw.prompt_tokens);
  const completionTokens = tokenCount(raw.completion_tokens);
  const totalTokens = tokenCount(raw.total_tokens);
  const cachedTokens = detailTokenCount(
    raw.prompt_tokens_details,
    "cached_tokens",
  );
  const cacheWriteTokens = detailTokenCount(
    raw.prompt_tokens_details,
    "cache_write_tokens",
  );
  const reasoningTokens = detailTokenCount(
    raw.completion_tokens_details,
    "reasoning_tokens",
  );
  const costUsd = dollarAmount(raw.cost);
  if (
    promptTokens === null &&
    completionTokens === null &&
    totalTokens === null &&
    cachedTokens === null &&
    cacheWriteTokens === null &&
    reasoningTokens === null &&
    costUsd === null
  ) {
    return null;
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens,
    cacheWriteTokens,
    reasoningTokens,
    costUsd,
  };
}

/**
 * Reads one non-negative count from a token-detail object. OpenRouter omits the
 * object when the capability does not apply, so a missing or malformed detail
 * yields null rather than failing the whole usage record.
 */
function detailTokenCount(details: unknown, key: string): number | null {
  if (typeof details !== "object" || details === null) {
    return null;
  }
  return tokenCount((details as Record<string, unknown>)[key]);
}

/** Reads a non-negative USD amount, or null when the value is unusable. */
function dollarAmount(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
    ? raw
    : null;
}

/** Reads a non-negative token count, or null when the value is unusable. */
function tokenCount(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
    ? Math.round(raw)
    : null;
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
    alias_target?: { slug?: unknown };
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
    aliasTargetSlug:
      typeof entry.alias_target?.slug === "string"
        ? entry.alias_target.slug
        : null,
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
