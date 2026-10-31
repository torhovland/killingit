import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BENCHMARK_PROMPTS,
  filterByMinimumAbility,
  parseAbilityGrade,
  validateReviseSeasonPlan,
  validateTodayPlan,
} from "../../apps/api/src/llm/promptBenchmark.js";
import type {
  BenchmarkPromptId,
  BenchmarkPromptDefinition,
} from "../../apps/api/src/llm/promptBenchmark.js";

const RUN_ID = process.env.RUN_ID ?? "2026-10-31-two-prompts";
const RUN_DIR = resolve(import.meta.dir, "runs", RUN_ID);
const API_URL = "https://openrouter.ai/api/v1";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 300_000);

interface OpenRouterModel {
  id: string;
  name: string;
  created?: number;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

interface Attempt {
  startedAt: string;
  timeMs: number;
  httpStatus: number | null;
  finishReason: string | null;
  usage: Usage | null;
  costUsd: number;
  raw: string;
  parsed: unknown | null;
  parseError: string | null;
  error: string | null;
}

interface PromptResult {
  prompt: BenchmarkPromptId;
  attempts: Attempt[];
  retryNeeded: boolean;
  ok: boolean;
  totalTimeMs: number;
  totalCostUsd: number;
  plan: unknown | null;
  validationErrors: string[];
}

interface ModelResult {
  id: string;
  name: string;
  requestedAt: string;
  prompts: Record<BenchmarkPromptId, PromptResult>;
  ok: boolean;
  totalTimeMs: number;
  totalCostUsd: number;
}

function slug(id: string): string {
  return id.replace(/[^a-zA-Z0-9.-]+/g, "_");
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  throw new Error("no parseable JSON object in response");
}

function validatePrompt(prompt: BenchmarkPromptId, plan: unknown): string[] {
  return prompt === "today"
    ? validateTodayPlan(plan)
    : validateReviseSeasonPlan(plan);
}

function tokensFor(
  definition: BenchmarkPromptDefinition,
  attempt: number,
): number {
  const overrideKey =
    definition.id === "today" ? "MAX_TOKENS" : "MAX_TOKENS_REVISE";
  const override = Number(process.env[overrideKey]);
  if (Number.isFinite(override) && override > 0) return override;
  return attempt === 0 ? definition.maxTokens : definition.retryMaxTokens;
}

async function callModel(
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number,
): Promise<Attempt> {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://killingit.local/benchmark",
        "X-Title": "Killingit prompt benchmark",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    const timeMs = performance.now() - started;
    let body: {
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: unknown; reasoning?: unknown };
      }>;
      usage?: Usage;
      error?: { message?: string } | string;
    } | null = null;
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      // keep null
    }
    const content = body?.choices?.[0]?.message?.content;
    const raw = typeof content === "string" ? content : "";
    const usage = body?.usage ?? null;
    const finishReason = body?.choices?.[0]?.finish_reason ?? null;
    const providerError =
      typeof body?.error === "string"
        ? body.error
        : (body?.error?.message ?? null);
    const error =
      providerError ??
      (!response.ok ? `HTTP ${response.status}` : null) ??
      (raw === "" ? "empty response content" : null);
    let parsed: unknown | null = null;
    let parseError: string | null = null;
    if (error === null) {
      try {
        parsed = extractJson(raw);
      } catch (err) {
        parseError = err instanceof Error ? err.message : String(err);
      }
    }
    return {
      startedAt,
      timeMs,
      httpStatus: response.status,
      finishReason,
      usage,
      costUsd: usage?.cost ?? 0,
      raw,
      parsed,
      parseError,
      error,
    };
  } catch (err) {
    return {
      startedAt,
      timeMs: performance.now() - started,
      httpStatus: null,
      finishReason: null,
      usage: null,
      costUsd: 0,
      raw: "",
      parsed: null,
      parseError: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runPrompt(
  apiKey: string,
  model: OpenRouterModel,
  definition: BenchmarkPromptDefinition,
  prompt: string,
): Promise<PromptResult> {
  const attempts: Attempt[] = [];
  let plan: unknown | null = null;
  let validationErrors: string[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await callModel(
      apiKey,
      model.id,
      prompt,
      tokensFor(definition, attempt),
    );
    attempts.push(result);
    if (result.parsed !== null) {
      const errors = validatePrompt(definition.id, result.parsed);
      if (errors.length === 0) {
        plan = result.parsed;
        validationErrors = [];
        break;
      }
      validationErrors = errors;
    }
  }

  return {
    prompt: definition.id,
    attempts,
    retryNeeded: attempts.length > 1,
    ok: plan !== null,
    totalTimeMs: attempts.reduce((sum, attempt) => sum + attempt.timeMs, 0),
    totalCostUsd: attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0),
    plan,
    validationErrors,
  };
}

async function runModel(
  apiKey: string,
  model: OpenRouterModel,
  prompts: ReadonlyMap<BenchmarkPromptId, string>,
  existing?: ModelResult,
): Promise<ModelResult> {
  const requestedAt = new Date().toISOString();
  const results = {} as Record<BenchmarkPromptId, PromptResult>;

  for (const definition of BENCHMARK_PROMPTS) {
    const prompt = prompts.get(definition.id);
    if (prompt === undefined) {
      throw new Error(`missing prompt text for ${definition.id}`);
    }
    const prior = existing?.prompts[definition.id];
    if (prior?.ok) {
      results[definition.id] = prior;
      continue;
    }
    const fresh = await runPrompt(apiKey, model, definition, prompt);
    results[definition.id] = prior
      ? {
          ...fresh,
          attempts: [...prior.attempts, ...fresh.attempts],
          retryNeeded: true,
          totalTimeMs: prior.totalTimeMs + fresh.totalTimeMs,
          totalCostUsd: prior.totalCostUsd + fresh.totalCostUsd,
        }
      : fresh;
  }

  await writeFile(
    resolve(RUN_DIR, "raw", `${slug(model.id)}.json`),
    `${JSON.stringify(
      BENCHMARK_PROMPTS.map((definition) => ({
        prompt: definition.id,
        attempts: results[definition.id].attempts,
      })),
      null,
      2,
    )}\n`,
  );

  const promptResults = BENCHMARK_PROMPTS.map(
    (definition) => results[definition.id],
  );
  return {
    id: model.id,
    name: model.name,
    requestedAt,
    prompts: results,
    ok: promptResults.every((result) => result.ok),
    totalTimeMs: promptResults.reduce(
      (sum, result) => sum + result.totalTimeMs,
      0,
    ),
    totalCostUsd: promptResults.reduce(
      (sum, result) => sum + result.totalCostUsd,
      0,
    ),
  };
}

function isCurrentResult(value: unknown): value is ModelResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Partial<ModelResult>;
  if (typeof result.prompts !== "object" || result.prompts === null)
    return false;
  return BENCHMARK_PROMPTS.every(
    (definition) => result.prompts?.[definition.id] !== undefined,
  );
}

function log(message: string): void {
  console.log(`prompt-benchmark> ${message}`);
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const prompts = new Map<BenchmarkPromptId, string>();
  for (const definition of BENCHMARK_PROMPTS) {
    prompts.set(
      definition.id,
      await readFile(resolve(import.meta.dir, definition.file), "utf8"),
    );
  }
  await mkdir(resolve(RUN_DIR, "raw"), { recursive: true });

  const modelsResponse = await fetch(`${API_URL}/models`);
  if (!modelsResponse.ok) {
    throw new Error(`models request failed: HTTP ${modelsResponse.status}`);
  }
  const modelsBody = (await modelsResponse.json()) as {
    data?: OpenRouterModel[];
  };
  let models = (modelsBody.data ?? [])
    .filter((model) => {
      const output = model.architecture?.output_modalities;
      return output === undefined || output.includes("text");
    })
    // Batch-only variants are asynchronous and cannot be called through the
    // synchronous chat-completions endpoint this benchmark uses.
    .filter((model) => !model.id.endsWith(":batch"))
    .sort((a, b) => a.id.localeCompare(b.id));

  const resultsPath = resolve(RUN_DIR, "results.json");
  let results: ModelResult[] = [];
  try {
    const parsed: unknown = JSON.parse(await readFile(resultsPath, "utf8"));
    results = Array.isArray(parsed) ? parsed.filter(isCurrentResult) : [];
  } catch {
    results = [];
  }
  const retryFailed = process.env.RETRY_FAILED === "1";
  if (retryFailed) {
    const failed = new Set(
      results.filter((result) => !result.ok).map((result) => result.id),
    );
    models = models.filter((model) => failed.has(model.id));
    const costOf = (id: string) =>
      results.find((result) => result.id === id)?.totalCostUsd ?? 0;
    models.sort((a, b) => costOf(a.id) - costOf(b.id));
    log(
      `retry mode: ${models.length} models with an unfinished prompt, cheapest first`,
    );
  }

  const catalog = await import("../../apps/api/src/llm/modelCatalog.js");
  if (process.env.PENDING_ONLY === "1") {
    const pending = new Set(await catalog.pendingBenchmarkModelIds());
    models = models.filter((model) => pending.has(model.id));
    log(`pending-only run: ${models.length} ungraded models`);
  }
  const minimumRaw = process.env.RESCORE_MIN_ABILITY?.trim();
  if (minimumRaw) {
    const minimum = parseAbilityGrade(minimumRaw);
    if (minimum === null) {
      throw new Error(`RESCORE_MIN_ABILITY is not a grade: ${minimumRaw}`);
    }
    const grades = await catalog.benchmarkAbilityGrades();
    models = filterByMinimumAbility(models, grades, minimum);
    log(
      `re-score filter: keeping ${models.length} models graded ${minimum} or better plus every ungraded model`,
    );
  }
  if (models.length === 0) {
    log("nothing to do; no model matched the selection");
    return;
  }
  await writeFile(
    resolve(RUN_DIR, "models.json"),
    `${JSON.stringify(models, null, 2)}\n`,
  );
  log(`running ${models.length} models at ${BENCHMARK_PROMPTS.length} prompts`);

  if (process.env.DRY_RUN === "1") {
    log("dry run: selection written to models.json, no calls made");
    return;
  }

  const done = retryFailed
    ? new Set<string>()
    : new Set(results.map((result) => result.id));
  const pending = retryFailed
    ? models
    : models.filter((model) => !done.has(model.id));
  log(`running ${pending.length} models (${done.size} already complete)`);

  let cursor = 0;
  let completed = done.size;

  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const index = cursor;
      cursor += 1;
      const model = pending[index];
      if (!model) return;
      const existing = retryFailed
        ? results.find((entry) => entry.id === model.id)
        : undefined;
      const result = await runModel(apiKey, model, prompts, existing);
      const resultIndex = results.findIndex((entry) => entry.id === result.id);
      if (resultIndex >= 0) results[resultIndex] = result;
      else results.push(result);
      completed += 1;
      const detail = BENCHMARK_PROMPTS.map((definition) => {
        const promptResult = result.prompts[definition.id];
        return `${definition.id} ${promptResult.ok ? "ok" : "FAILED"} ${(promptResult.totalTimeMs / 1000).toFixed(1)}s $${promptResult.totalCostUsd.toFixed(4)}`;
      }).join(" | ");
      log(
        `[${completed}/${models.length}] ${model.id} ${detail} ` +
          `total ${(result.totalTimeMs / 1000).toFixed(1)}s $${result.totalCostUsd.toFixed(4)}`,
      );
      await writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  log(
    `done: ${results.filter((result) => result.ok).length}/${models.length} valid on both prompts`,
  );
}

await main();
