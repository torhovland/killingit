import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { LlmModel, LlmModelGrade } from "@killingit/shared";
import { SPEED_F_LIMIT_MS } from "../../../apps/api/src/llm/modelCatalog.js";
import {
  createOpenRouterProvider,
  type LlmMessage,
  type LlmProvider,
} from "../../../apps/api/src/llm/openrouter.js";
import {
  benchmarkAbilityGrades,
  benchmarkCostGrades,
  benchmarkModelTimes,
  pendingBenchmarkModelIds,
} from "./catalogBenchmark.js";
import {
  logPromptBenchmark,
  promptBenchmarkRunDirectory,
  promptBenchmarkSlug,
  readPromptJsonOr,
  writePromptJson,
} from "./promptBenchmarkFiles.js";
import {
  BENCHMARK_PROMPTS,
  buildBenchmarkPromptMessages,
  type BenchmarkPromptDefinition,
  type BenchmarkPromptId,
  type BenchmarkPromptMessage,
} from "./promptBenchmarkInput.js";
import {
  extractJson,
  filterByCostGrades,
  filterByMinimumAbility,
  parseAbilityGrade,
  sortByPreviousTime,
  validatePromptPlan,
} from "./promptBenchmark.js";
import { completePrompt } from "./promptBenchmarkProvider.js";
import type {
  PromptAttempt,
  PromptAttemptRecord,
  PromptModelResult,
  PromptRunResult,
} from "./promptBenchmarkTypes.js";

/**
 * Mirrors the app provider's per-request timeout. The benchmark asks for a
 * timeout and the provider caps it, so reporting a timeout stays accurate.
 */
const PROVIDER_REQUEST_TIMEOUT_MS = 240_000;

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

/**
 * Calls one model once through the app's `LlmProvider`, recording the same
 * diagnostics the old raw fetch client did: status, finish reason, usage,
 * reported cost, raw text and the parse error when the answer is not JSON.
 */
async function callPromptModel(
  provider: LlmProvider,
  apiKey: string,
  model: string,
  messages: readonly BenchmarkPromptMessage[],
  maxTokens: number,
  timeoutMs: number,
): Promise<PromptAttempt> {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const llmMessages: LlmMessage[] = messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const completion = await completePrompt(
    provider,
    {
      apiKey,
      model,
      messages: llmMessages,
      temperature: 0.2,
      maxTokens,
    },
    timeoutMs,
  );
  let parsed: unknown = null;
  let parseError: string | null = null;
  if (completion.error === null) {
    try {
      parsed = extractJson(completion.text);
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    startedAt,
    timeMs: performance.now() - started,
    httpStatus: completion.httpStatus,
    finishReason: completion.finishReason,
    usage: completion.usage,
    costUsd: completion.costUsd,
    raw: completion.text,
    parsed,
    parseError,
    error: completion.error,
  };
}

async function runPrompt(
  provider: LlmProvider,
  apiKey: string,
  model: string,
  definition: BenchmarkPromptDefinition,
  messages: readonly BenchmarkPromptMessage[],
  deadline: number,
): Promise<PromptRunResult> {
  const attempts: PromptAttempt[] = [];
  let plan: unknown = null;
  let validationErrors: string[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    const timeoutMs = Math.min(
      Number(process.env.TIMEOUT_MS ?? 300_000),
      remaining,
      PROVIDER_REQUEST_TIMEOUT_MS,
    );
    const result = await callPromptModel(
      provider,
      apiKey,
      model,
      messages,
      tokensFor(definition, attempt),
      timeoutMs,
    );
    attempts.push(result);
    if (result.parsed !== null) {
      const errors = validatePromptPlan(definition.id, result.parsed);
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
  provider: LlmProvider,
  apiKey: string,
  model: LlmModel,
  prompts: ReadonlyMap<BenchmarkPromptId, readonly BenchmarkPromptMessage[]>,
  runDirectory: string,
  existing?: PromptModelResult,
): Promise<PromptModelResult> {
  const requestedAt = new Date().toISOString();
  const started = performance.now();
  const deadline = started + SPEED_F_LIMIT_MS;
  const results = {} as Record<BenchmarkPromptId, PromptRunResult>;

  for (const definition of BENCHMARK_PROMPTS) {
    const messages = prompts.get(definition.id);
    if (messages === undefined) {
      throw new Error(`missing prompt messages for ${definition.id}`);
    }
    const prior = existing?.prompts[definition.id];
    if (prior?.ok) {
      results[definition.id] = prior;
      continue;
    }
    const fresh = await runPrompt(
      provider,
      apiKey,
      model.id,
      definition,
      messages,
      deadline,
    );
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

  const attemptRecords: PromptAttemptRecord[] = BENCHMARK_PROMPTS.map(
    (definition) => ({
      prompt: definition.id,
      attempts: results[definition.id].attempts,
    }),
  );
  await writePromptJson(
    resolve(runDirectory, "raw", `${promptBenchmarkSlug(model.id)}.json`),
    attemptRecords,
  );

  const promptResults = BENCHMARK_PROMPTS.map(
    (definition) => results[definition.id],
  );
  const promptTimeMs = promptResults.reduce(
    (sum, result) => sum + result.totalTimeMs,
    0,
  );
  // A model that would grade F on speed is left ungraded ("?") instead of
  // waiting for it or recording a failed ability.
  const expired =
    promptTimeMs >= SPEED_F_LIMIT_MS ||
    performance.now() - started >= SPEED_F_LIMIT_MS;
  return {
    id: model.id,
    name: model.name,
    requestedAt,
    prompts: results,
    ok: !expired && promptResults.every((result) => result.ok),
    expired,
    totalTimeMs: expired
      ? Math.max(promptTimeMs, SPEED_F_LIMIT_MS)
      : promptTimeMs,
    totalCostUsd: promptResults.reduce(
      (sum, result) => sum + result.totalCostUsd,
      0,
    ),
  };
}

function isCurrentResult(value: unknown): value is PromptModelResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Partial<PromptModelResult>;
  if (typeof result.prompts !== "object" || result.prompts === null)
    return false;
  return BENCHMARK_PROMPTS.every(
    (definition) => result.prompts?.[definition.id] !== undefined,
  );
}

function parseGradeSet(
  raw: string | undefined,
  variable: string,
): Set<LlmModelGrade> {
  const grades = new Set<LlmModelGrade>();
  for (const item of (raw ?? "").split(",")) {
    const value = item.trim();
    if (value === "") continue;
    const grade = parseAbilityGrade(value);
    if (grade === null) {
      throw new Error(`${variable} is not a grade: ${value}`);
    }
    grades.add(grade);
  }
  return grades;
}

async function selectModels(
  listed: readonly LlmModel[],
  results: readonly PromptModelResult[],
): Promise<LlmModel[]> {
  let models = [...listed].sort((a, b) => a.id.localeCompare(b.id));

  const retryFailed = process.env.RETRY_FAILED === "1";
  if (retryFailed) {
    const failed = new Set(
      results
        .filter((result) => !result.ok && result.expired !== true)
        .map((result) => result.id),
    );
    models = models.filter((model) => failed.has(model.id));
    const costOf = (id: string) =>
      results.find((result) => result.id === id)?.totalCostUsd ?? 0;
    models.sort((a, b) => costOf(a.id) - costOf(b.id));
    logPromptBenchmark(
      `retry mode: ${models.length} models with an unfinished prompt, cheapest first`,
    );
  }

  if (process.env.PENDING_ONLY === "1") {
    const pending = new Set(await pendingBenchmarkModelIds());
    models = models.filter((model) => pending.has(model.id));
    logPromptBenchmark(`pending-only run: ${models.length} ungraded models`);
  }

  const minimumRaw = process.env.RESCORE_MIN_ABILITY?.trim();
  const costRaw = process.env.RESCORE_COST_GRADE?.trim();
  const allowedCostGrades = parseGradeSet(costRaw, "RESCORE_COST_GRADE");
  for (const grade of parseGradeSet(
    process.env.INCLUDE_COST_GRADES?.trim(),
    "INCLUDE_COST_GRADES",
  )) {
    allowedCostGrades.add(grade);
  }
  const excludedAbilityGrades = parseGradeSet(
    process.env.EXCLUDE_ABILITY_GRADES?.trim(),
    "EXCLUDE_ABILITY_GRADES",
  );
  const includedModelIds = new Set(
    (process.env.INCLUDE_MODELS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== ""),
  );
  const filtering =
    minimumRaw !== undefined ||
    allowedCostGrades.size > 0 ||
    includedModelIds.size > 0 ||
    excludedAbilityGrades.size > 0;
  if (filtering) {
    const filters: string[] = [];
    if (minimumRaw) {
      const minimum = parseAbilityGrade(minimumRaw);
      if (minimum === null) {
        throw new Error(`RESCORE_MIN_ABILITY is not a grade: ${minimumRaw}`);
      }
      const grades = await benchmarkAbilityGrades();
      models = filterByMinimumAbility(models, grades, minimum);
      filters.push(`ability ${minimum} or better plus every ungraded model`);
    }
    if (allowedCostGrades.size > 0 || includedModelIds.size > 0) {
      const grades = await benchmarkCostGrades();
      if (includedModelIds.size === 0 && excludedAbilityGrades.size === 0) {
        models = filterByCostGrades(models, grades, allowedCostGrades);
      } else {
        const abilityGrades =
          excludedAbilityGrades.size > 0
            ? await benchmarkAbilityGrades()
            : null;
        models = models.filter((model) => {
          if (includedModelIds.has(model.id)) return true;
          const grade = grades.get(model.id);
          if (grade === undefined || !allowedCostGrades.has(grade)) {
            return false;
          }
          if (
            abilityGrades !== null &&
            excludedAbilityGrades.has(abilityGrades.get(model.id) ?? "?")
          ) {
            return false;
          }
          return true;
        });
      }
      if (allowedCostGrades.size > 0) {
        filters.push(`cost ${[...allowedCostGrades].join(", ")}`);
      }
      if (includedModelIds.size > 0) {
        filters.push(`${includedModelIds.size} named model(s)`);
      }
    } else if (excludedAbilityGrades.size > 0) {
      const abilityGrades = await benchmarkAbilityGrades();
      models = models.filter(
        (model) =>
          !excludedAbilityGrades.has(abilityGrades.get(model.id) ?? "?"),
      );
    }
    if (excludedAbilityGrades.size > 0) {
      filters.push(
        `ability not ${[...excludedAbilityGrades].join(", ")} except named models`,
      );
    }
    const beforeAliases = models.length;
    // Aliases must never be benchmarked on their own: run the concrete target
    // and copy its result afterwards, so an alias cannot diverge from it.
    models = models.filter((model) => model.aliasTargetSlug === null);
    logPromptBenchmark(
      `selection filter: keeping ${models.length} models with ${filters.join(" and ")}; ` +
        `skipped ${beforeAliases - models.length} alias(es) for later copying`,
    );
  }
  if (process.env.SORT?.trim() === "slowest") {
    const times = await benchmarkModelTimes();
    models = sortByPreviousTime(models, times);
    logPromptBenchmark("ordered slowest first by previous benchmark time");
  }
  return models;
}

/**
 * Runs both benchmark prompts for every selected model and writes
 * `models.json`, `raw/<model>.json` and `results.json` into the run directory.
 */
export async function runPromptBenchmarkRunStage(): Promise<void> {
  const apiKey = process.env.BENCHMARK_OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("BENCHMARK_OPENROUTER_API_KEY is not set");
  const runDirectory = promptBenchmarkRunDirectory();
  const prompts = new Map<BenchmarkPromptId, BenchmarkPromptMessage[]>();
  for (const definition of BENCHMARK_PROMPTS) {
    prompts.set(definition.id, buildBenchmarkPromptMessages(definition.id));
  }
  await mkdir(resolve(runDirectory, "raw"), { recursive: true });

  const provider = createOpenRouterProvider();
  const listed = await provider.listModels();

  const resultsPath = resolve(runDirectory, "results.json");
  const parsedResults = await readPromptJsonOr<unknown>(resultsPath, []);
  const results = Array.isArray(parsedResults)
    ? parsedResults.filter(isCurrentResult)
    : [];
  const models = await selectModels(listed, results);

  if (models.length === 0) {
    logPromptBenchmark("nothing to do; no model matched the selection");
    return;
  }
  await writePromptJson(resolve(runDirectory, "models.json"), models);
  logPromptBenchmark(
    `running ${models.length} models at ${BENCHMARK_PROMPTS.length} prompts`,
  );

  if (process.env.DRY_RUN === "1") {
    logPromptBenchmark(
      "dry run: selection written to models.json, no calls made",
    );
    return;
  }

  const retryFailed = process.env.RETRY_FAILED === "1";
  const done = retryFailed
    ? new Set<string>()
    : new Set(results.map((result) => result.id));
  const pending = retryFailed
    ? models
    : models.filter((model) => !done.has(model.id));
  logPromptBenchmark(
    `running ${pending.length} models (${done.size} already complete)`,
  );

  const concurrency = Math.max(1, Number(process.env.CONCURRENCY ?? 10));
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
      const result = await runModel(
        provider,
        apiKey,
        model,
        prompts,
        runDirectory,
        existing,
      );
      const resultIndex = results.findIndex((entry) => entry.id === result.id);
      if (resultIndex >= 0) results[resultIndex] = result;
      else results.push(result);
      completed += 1;
      const detail = BENCHMARK_PROMPTS.map((definition) => {
        const promptResult = result.prompts[definition.id];
        return `${definition.id} ${promptResult.ok ? "ok" : "FAILED"} ${(promptResult.totalTimeMs / 1000).toFixed(1)}s $${promptResult.totalCostUsd.toFixed(4)}`;
      }).join(" | ");
      logPromptBenchmark(
        `[${completed}/${models.length}] ${model.id} ${detail} ` +
          `total ${(result.totalTimeMs / 1000).toFixed(1)}s $${result.totalCostUsd.toFixed(4)}` +
          (result.expired === true ? " expired (ability stays ?)" : ""),
      );
      await writePromptJson(resultsPath, results);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  logPromptBenchmark(
    `done: ${results.filter((result) => result.ok).length}/${results.length} models valid on both prompts`,
  );
}
