import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PROMPT_PATH = resolve(import.meta.dir, "prompt.txt");
const RUN_ID = process.env.RUN_ID ?? "2026-10-30-all-models";
const RUN_DIR = resolve(import.meta.dir, "runs", RUN_ID);
const API_URL = "https://openrouter.ai/api/v1";
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 8192);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 240_000);

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

interface ModelResult {
  id: string;
  name: string;
  requestedAt: string;
  attempts: Attempt[];
  retryNeeded: boolean;
  ok: boolean;
  totalTimeMs: number;
  totalCostUsd: number;
  plan: unknown | null;
  validationErrors: string[];
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

const todaySessionSchema = {
  required: [
    "date",
    "status",
    "title",
    "type",
    "intensity",
    "durationMinutes",
    "outdoor",
    "canBeOutdoor",
    "estimatedTss",
    "estimatedFtpWatts",
    "bikeWorkout",
    "description",
    "optional",
    "optionalRationale",
  ],
  types: {
    date: "string",
    status: "string",
    title: "string",
    type: "string",
    intensity: "string",
    durationMinutes: "number",
    outdoor: "boolean",
    canBeOutdoor: "boolean",
    estimatedTss: "number",
    estimatedFtpWatts: "number",
    bikeWorkout: "object",
    description: "string",
    optional: "boolean",
    optionalRationale: "string",
  },
} as const;

function validate(plan: unknown): string[] {
  const errors: string[] = [];
  if (typeof plan !== "object" || plan === null) {
    return ["response is not an object"];
  }
  const root = plan as Record<string, unknown>;
  const extraKeys = Object.keys(root).filter((key) => key !== "today");
  if (extraKeys.length > 0)
    errors.push(`unexpected root keys: ${extraKeys.join(", ")}`);
  const today = root.today;
  if (typeof today !== "object" || today === null) {
    return [...errors, "missing today object"];
  }
  const session = today as Record<string, unknown>;
  for (const key of todaySessionSchema.required) {
    if (!(key in session)) errors.push(`missing field: ${key}`);
  }
  for (const [key, type] of Object.entries(todaySessionSchema.types)) {
    if (!(key in session)) continue;
    const value = session[key];
    if (key === "bikeWorkout") {
      if (value !== null && typeof value !== "object") {
        errors.push("bikeWorkout must be null or an object");
      }
      continue;
    }
    if (typeof value !== type) errors.push(`${key} must be a ${type}`);
  }
  if (session.date !== "2026-10-30") errors.push("date must be 2026-10-30");
  if (session.type !== "workout" && session.type !== "rest") {
    errors.push("type must be workout or rest");
  }
  if (
    !["easy", "moderate", "hard", "rest"].includes(String(session.intensity))
  ) {
    errors.push("intensity must be easy, moderate, hard or rest");
  }
  return errors;
}

async function callModel(
  apiKey: string,
  model: string,
  prompt: string,
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
        "X-Title": "Killingit today-prompt benchmark",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: MAX_TOKENS,
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

async function runModel(
  apiKey: string,
  model: OpenRouterModel,
  prompt: string,
): Promise<ModelResult> {
  const requestedAt = new Date().toISOString();
  const attempts: Attempt[] = [];
  let plan: unknown | null = null;
  let validationErrors: string[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await callModel(apiKey, model.id, prompt);
    attempts.push(result);
    if (result.parsed !== null) {
      const errors = validate(result.parsed);
      if (errors.length === 0) {
        plan = result.parsed;
        validationErrors = [];
        break;
      }
      validationErrors = errors;
    }
  }

  await writeFile(
    resolve(RUN_DIR, "raw", `${slug(model.id)}.json`),
    `${JSON.stringify(attempts, null, 2)}\n`,
  );

  const totalTimeMs = attempts.reduce((sum, a) => sum + a.timeMs, 0);
  const totalCostUsd = attempts.reduce((sum, a) => sum + a.costUsd, 0);
  return {
    id: model.id,
    name: model.name,
    requestedAt,
    attempts,
    retryNeeded: attempts.length > 1,
    ok: plan !== null,
    totalTimeMs,
    totalCostUsd,
    plan,
    validationErrors,
  };
}

function log(message: string): void {
  console.log(`today-benchmark> ${message}`);
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const prompt = await readFile(PROMPT_PATH, "utf8");
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
    .sort((a, b) => a.id.localeCompare(b.id));
  if (process.env.PENDING_ONLY === "1") {
    const { pendingBenchmarkModelIds } =
      await import("../../apps/api/src/llm/modelCatalog.js");
    const pending = new Set(await pendingBenchmarkModelIds());
    models = models.filter((model) => pending.has(model.id));
    log(`pending-only run: ${models.length} ungraded models`);
    if (models.length === 0) {
      log("nothing to do; every catalog model already has a score");
      return;
    }
  }
  await writeFile(
    resolve(RUN_DIR, "models.json"),
    `${JSON.stringify(models, null, 2)}\n`,
  );
  log(`running ${models.length} models`);

  const resultsPath = resolve(RUN_DIR, "results.json");
  let results: ModelResult[] = [];
  try {
    results = JSON.parse(await readFile(resultsPath, "utf8")) as ModelResult[];
  } catch {
    results = [];
  }
  const done = new Set(results.map((result) => result.id));
  const pending = models.filter((model) => !done.has(model.id));
  log(`running ${pending.length} models (${done.size} already complete)`);

  let cursor = 0;
  let completed = done.size;

  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const index = cursor;
      cursor += 1;
      const model = pending[index];
      if (!model) return;
      const result = await runModel(apiKey, model, prompt);
      results.push(result);
      completed += 1;
      log(
        `[${completed}/${models.length}] ${model.id} ` +
          `${result.ok ? "ok" : "FAILED"} ${(result.totalTimeMs / 1000).toFixed(1)}s ` +
          `$${result.totalCostUsd.toFixed(4)}${result.retryNeeded ? " retry" : ""}`,
      );
      await writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  log(`done: ${results.filter((r) => r.ok).length}/${models.length} valid`);
}

await main();
