import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BENCHMARK_PROMPTS,
  checkReviseSeasonGates,
  combinePromptScores,
  parseCurrentBlock,
} from "../../apps/api/src/llm/promptBenchmark.js";
import type {
  BenchmarkPromptDefinition,
  BenchmarkPromptId,
  ReviseSeasonGates,
} from "../../apps/api/src/llm/promptBenchmark.js";

const RUN_ID = process.env.RUN_ID ?? "2026-10-31-two-prompts";
const RUN_DIR = resolve(import.meta.dir, "runs", RUN_ID);
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "anthropic/claude-haiku-5.5";
const API_URL = "https://openrouter.ai/api/v1";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 15);
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 4000);

interface Attempt {
  timeMs: number;
  costUsd: number;
  raw: string;
  parsed: unknown | null;
  parseError: string | null;
  error: string | null;
}

interface PromptResult {
  prompt: BenchmarkPromptId;
  attempts: Attempt[];
  ok: boolean;
  plan: unknown | null;
  validationErrors: string[];
}

interface ModelResult {
  id: string;
  name: string;
  prompts: Record<BenchmarkPromptId, PromptResult>;
  ok: boolean;
}

interface PromptJudge {
  score: number;
  components: Record<string, number>;
  note: string;
  judge: {
    model: string;
    attempts: number;
    timeMs: number;
    costUsd: number;
    error: string | null;
  };
}

interface JudgeScore extends PromptJudge {
  id: string;
  failed: boolean;
  gates: ReviseSeasonGates | null;
  prompts: Record<BenchmarkPromptId, PromptJudge>;
}

const ZERO_COMPONENTS = {
  contract: 0,
  fidelity: 0,
  design: 0,
  rationale: 0,
  grounding: 0,
  detail: 0,
};

const TODAY_RUBRIC = `You are a strict, expert endurance-coaching judge. You evaluate another model's answer to a coaching prompt. Do not answer the coaching prompt yourself and do not produce a training plan. Only evaluate the candidate JSON.

You will receive the exact original prompt given to the candidate and the candidate's JSON response. Infer the athlete's context, constraints, current plan and the required session from the original prompt. Do not assume facts that are not in it.

Score the candidate on these six components. Be strict but fair. Judge the coaching content, not writing style alone.

1. contract (0-1.5): valid JSON, exactly the requested "today" object, required fields present with the right types and enum values, no extra root keys, no prose around the JSON, no code fence. Extra fields inside "today" are a minor issue, not a failure.

2. fidelity (0-2.0): the candidate matches the date, status, session type, duration, intensity, indoor/outdoor flags, bikeWorkout, FTP, TSS and other constraints stated in the original prompt and the current plan. Marking today completed when no activity is recorded, inventing an activity, or replacing the planned session with an unrelated one loses points.

3. design (0-3.0): a specific, safe, well-sequenced session that fits the athlete's goals, experience, equipment, recent training and the current plan. Reward sensible exercise selection, sets and reps, rest, progression and safety. Penalize vague, generic or unsafe prescriptions. Do not require any particular exercise.

4. rationale (0-2.0): optionalRationale explains why this session is right for the athlete now and what is lost by skipping. Reward specific, grounded reasoning tied to the athlete's goals and current plan. Penalize empty, generic or purely motivational text.

5. grounding (0-2.0): uses the athlete's actual profile, recent activities, comments, constraints and current plan; makes no invented claims; does not hallucinate a completed activity; respects the athlete's time, equipment, weather and daylight limits.

6. detail (0-2.0): extra, useful execution detail in the description. Reward load progression or RPE/rep-in-reserve guidance, technique cues, stop conditions, fallbacks or alternatives for missing equipment or pain, explicit assumptions for unknown loads, exercise-specific notes, and success criteria. Do not reward padding, repetition or irrelevant text. A concise plan can earn high detail if every extra sentence helps execution.

Return ONLY a JSON object in this exact shape:
{"contract": 0.0, "fidelity": 0.0, "design": 0.0, "rationale": 0.0, "grounding": 0.0, "detail": 0.0, "score": 0.0, "judgment": "2-4 specific sentences"}

The score is the sum of the six components (maximum 12.5), rounded to one decimal. The judgment should say what was strong and what was weak in this specific candidate.

Return strict JSON. Inside the judgment string, do not use quotation marks of any kind (no double quotes and no single quotes). Do not use raw newlines inside the judgment. Refer to field names and phrases without quoting them.`;

const REVISE_SEASON_RUBRIC = `You are a strict, expert endurance-coaching judge. You evaluate another model's answer to a coaching prompt. Do not answer the coaching prompt yourself and do not produce a training plan. Only evaluate the candidate JSON.

You will receive the exact original prompt given to the candidate and the candidate's JSON response. The original prompt asks the model to refresh an existing season plan after the athlete has added a drastic new goal: the Atlas Mountain Race on 25 December 2026, about eight weeks after the revision date. The revision request says the season and the current block must be refreshed in place, block 1 must start on 2026-10-26, blocks that ended before today must stay as supplied, the remainder of the season must be re-planned without gaps and cover the rest of the season, the current week and today must be revised coherently, and tomorrow, next week and next block must stay null because they were supplied as null.

A correct answer must mention Atlas, must produce a genuinely changed block 1, and must keep block 1 starting on 2026-10-26. Those three requirements are also checked mechanically, so their absence is already a hard failure; do not let strong writing hide it, and do not award credit for content the athlete did not supply.

Score the candidate on these six components. Be strict but fair. Judge the coaching content, not writing style alone.

1. contract (0-1.5): valid JSON with exactly the eight top-level keys, season, block, week and today objects using the contract's field names and types, seven week sessions, a matching today session, bodyMetrics array, and no prose or extra fields.

2. fidelity (0-2.0): follows every instruction in the revision request. The season is refreshed in place, block 1 starts on 2026-10-26, earlier blocks are untouched, later blocks follow one another without gaps to the season end, the current block is detailed, the current week is coherent with it, today is revised, and tomorrow, nextWeek and nextBlock stay null. It keeps dates, athlete goals and stored facts consistent.

3. design (0-3.0): the revised season makes sense as a response to a drastic change. Reward a credible roughly eight-week build to a late-December bikepacking race in Morocco, with a sane taper and recovery, while preserving Paris-Brest-Paris in August 2027, the spring brevet series including the April 200 km, the sub-23-minute 5K on 5 May 2027, the 10K on 5 September 2027, fat loss, hip and back strength and mobility, the Norwegian winter, the athlete's limited tolerance for more than about four months of strict disciplined training, and the available weekday and weekend time. Penalise plans that ignore Atlas, keep the old season shape, overload or detrain the athlete, invent races or numbers, or break the chronological season logic.

4. rationale (2.0): specific, current, athlete-grounded reasons for the season shape, the block, its weeks and today. Each rationale explains the plan as it stands and why it fits the next races and the athlete's constraints. Penalise meta-commentary about adjusting, rewriting or replacing the old plan, and generic encouragement.

5. grounding (2.0): uses the supplied athlete profile, thresholds, body metrics, activities, comments, weather and dates; invents no facts; keeps FTP, TSS and body metrics consistent with the input; respects the athlete's time, equipment, daylight and weather constraints.

6. detail (2.0): concrete week targets and progression, a specific block plan, a coherent current week and useful execution detail for today. Reward realistic load, recovery and back-safe progression. Do not reward padding or repetition.

Return ONLY a JSON object in this exact shape:
{"contract": 0.0, "fidelity": 0.0, "design": 0.0, "rationale": 0.0, "grounding": 0.0, "detail": 0.0, "score": 0.0, "judgment": "2-4 specific sentences"}

The score is the sum of the six components (maximum 12.5), rounded to one decimal. The judgment should say what was strong and what was weak in this specific candidate.

Return strict JSON. Inside the judgment string, do not use quotation marks of any kind (no double quotes and no single quotes). Do not use raw newlines inside the judgment. Refer to field names and phrases without quoting them.`;

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
      // try next
    }
  }
  throw new Error("no parseable JSON in judge response");
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseJudge(value: unknown): {
  components: Record<string, number>;
  score: number;
  note: string;
} | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  const contract = asNumber(entry.contract);
  const fidelity = asNumber(entry.fidelity);
  const design = asNumber(entry.design);
  const rationale = asNumber(entry.rationale);
  const grounding = asNumber(entry.grounding);
  const detail = asNumber(entry.detail);
  const score = asNumber(entry.score);
  const note = typeof entry.judgment === "string" ? entry.judgment.trim() : "";
  if (
    contract === null ||
    fidelity === null ||
    design === null ||
    rationale === null ||
    grounding === null ||
    detail === null ||
    score === null ||
    note === ""
  ) {
    return null;
  }
  const components = {
    contract: Math.max(0, Math.min(1.5, contract)),
    fidelity: Math.max(0, Math.min(2, fidelity)),
    design: Math.max(0, Math.min(3, design)),
    rationale: Math.max(0, Math.min(2, rationale)),
    grounding: Math.max(0, Math.min(2, grounding)),
    detail: Math.max(0, Math.min(2, detail)),
  };
  return {
    components,
    score:
      Math.round(
        (components.contract +
          components.fidelity +
          components.design +
          components.rationale +
          components.grounding +
          components.detail) *
          10,
      ) / 10,
    note,
  };
}

async function callJudge(
  apiKey: string,
  rubric: string,
  originalPrompt: string,
  candidate: unknown,
): Promise<Attempt> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240_000);
  try {
    const response = await fetch(`${API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://killingit.local/benchmark",
        "X-Title": "Killingit prompt judge",
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        messages: [
          { role: "system", content: rubric },
          {
            role: "user",
            content: `## ORIGINAL PROMPT GIVEN TO THE CANDIDATE\n\n${originalPrompt}\n\n## CANDIDATE JSON RESPONSE\n\n${JSON.stringify(candidate, null, 2)}\n\nScore the candidate now. Return only the JSON scoring object.`,
          },
        ],
        max_tokens: MAX_TOKENS,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    const timeMs = performance.now() - started;
    let body: {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { cost?: number };
      error?: { message?: string } | string;
    } | null = null;
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      body = null;
    }
    const content = body?.choices?.[0]?.message?.content;
    const raw = typeof content === "string" ? content : "";
    const providerError =
      typeof body?.error === "string"
        ? body.error
        : (body?.error?.message ?? null);
    const error =
      providerError ??
      (!response.ok ? `HTTP ${response.status}` : null) ??
      (raw === "" ? "empty judge response" : null);
    let parsed: unknown | null = null;
    if (error === null) {
      try {
        parsed = extractJson(raw);
      } catch {
        parsed = null;
      }
    }
    return {
      timeMs,
      costUsd: body?.usage?.cost ?? 0,
      raw,
      parsed,
      error:
        error ?? (parsed === null ? "judge response was not valid JSON" : null),
    };
  } catch (err) {
    return {
      timeMs: performance.now() - started,
      costUsd: 0,
      raw: "",
      parsed: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function unjudgedPrompt(note: string): PromptJudge {
  return {
    score: 0,
    components: { ...ZERO_COMPONENTS },
    note,
    judge: {
      model: JUDGE_MODEL,
      attempts: 0,
      timeMs: 0,
      costUsd: 0,
      error: null,
    },
  };
}

async function judgePrompt(
  apiKey: string,
  definition: BenchmarkPromptDefinition,
  originalPrompt: string,
  result: PromptResult,
): Promise<PromptJudge> {
  if (!result.ok || result.plan === null) {
    const last = result.attempts.at(-1);
    const reason =
      last?.error ??
      last?.parseError ??
      result.validationErrors.join("; ") ??
      "no valid JSON";
    return unjudgedPrompt(
      `No valid JSON was returned for the ${definition.label.toLowerCase()} prompt after ${result.attempts.length} attempt(s): ${reason}.`,
    );
  }

  const rubric =
    definition.id === "today" ? TODAY_RUBRIC : REVISE_SEASON_RUBRIC;
  const attempts: Attempt[] = [];
  let judged: ReturnType<typeof parseJudge> = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const judgeAttempt = await callJudge(
      apiKey,
      rubric,
      originalPrompt,
      result.plan,
    );
    attempts.push(judgeAttempt);
    if (judgeAttempt.parsed !== null) {
      judged = parseJudge(judgeAttempt.parsed);
      if (judged !== null) break;
    }
  }

  const error =
    judged === null
      ? (attempts.at(-1)?.error ?? "judge did not return usable scores")
      : null;

  return {
    score: judged?.score ?? 0,
    components: judged?.components ?? { ...ZERO_COMPONENTS },
    note:
      judged?.note ??
      `The judge could not score the ${definition.label.toLowerCase()} response: ${error}.`,
    judge: {
      model: JUDGE_MODEL,
      attempts: attempts.length,
      timeMs: attempts.reduce((sum, attempt) => sum + attempt.timeMs, 0),
      costUsd: attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0),
      error,
    },
  };
}

function isCurrentScore(value: unknown): value is JudgeScore {
  if (typeof value !== "object" || value === null) return false;
  const score = value as Partial<JudgeScore>;
  if (typeof score.prompts !== "object" || score.prompts === null) return false;
  return BENCHMARK_PROMPTS.every(
    (definition) => score.prompts?.[definition.id] !== undefined,
  );
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const promptTexts = new Map<BenchmarkPromptId, string>();
  for (const definition of BENCHMARK_PROMPTS) {
    promptTexts.set(
      definition.id,
      await readFile(resolve(import.meta.dir, definition.file), "utf8"),
    );
  }
  const revisePrompt = promptTexts.get("reviseSeason");
  if (revisePrompt === undefined) {
    throw new Error("missing revise-season prompt");
  }
  const baseline = parseCurrentBlock(revisePrompt);
  if (baseline === null) {
    throw new Error(
      "could not read the supplied current block from revise-season-prompt.txt",
    );
  }

  const results = JSON.parse(
    await readFile(resolve(RUN_DIR, "results.json"), "utf8"),
  ) as ModelResult[];

  const outputPath = resolve(RUN_DIR, "judge-scores.json");
  let scores: JudgeScore[] = [];
  try {
    const parsed: unknown = JSON.parse(await readFile(outputPath, "utf8"));
    scores = Array.isArray(parsed) ? parsed.filter(isCurrentScore) : [];
  } catch {
    scores = [];
  }
  const retryFailedJudges = process.env.RETRY_FAILED_JUDGES === "1";
  const done = new Set(
    scores
      .filter(
        (score) =>
          !retryFailedJudges ||
          (score.prompts.today.judge.error === null &&
            score.prompts.reviseSeason.judge.error === null),
      )
      .map((score) => score.id),
  );
  const onlyValid = process.env.ONLY_VALID === "1";
  const limit = Number(process.env.LIMIT ?? Number.POSITIVE_INFINITY);
  const pending = results
    .filter((result) => !done.has(result.id))
    .filter((result) => !onlyValid || result.ok)
    .slice(0, limit);
  console.log(
    `judging ${pending.length} models with ${JUDGE_MODEL} at ${BENCHMARK_PROMPTS.length} prompts (${done.size} already done)`,
  );

  let cursor = 0;
  let completed = done.size;
  const write = async () => {
    await writeFile(outputPath, `${JSON.stringify(scores, null, 2)}\n`);
  };

  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const index = cursor;
      cursor += 1;
      const result = pending[index];
      if (!result) return;
      const started = performance.now();
      const promptJudges = {} as Record<BenchmarkPromptId, PromptJudge>;
      for (const definition of BENCHMARK_PROMPTS) {
        const originalPrompt = promptTexts.get(definition.id);
        if (originalPrompt === undefined) {
          throw new Error(`missing prompt text for ${definition.id}`);
        }
        promptJudges[definition.id] = await judgePrompt(
          apiKey,
          definition,
          originalPrompt,
          result.prompts[definition.id],
        );
      }

      const gates = checkReviseSeasonGates(
        result.prompts.reviseSeason.plan,
        baseline,
      );
      const combined = combinePromptScores(
        promptJudges.today,
        promptJudges.reviseSeason,
        gates.failures,
      );
      const judgeTimeMs = BENCHMARK_PROMPTS.reduce(
        (sum, definition) => sum + promptJudges[definition.id].judge.timeMs,
        0,
      );
      const judgeCostUsd = BENCHMARK_PROMPTS.reduce(
        (sum, definition) => sum + promptJudges[definition.id].judge.costUsd,
        0,
      );
      const judgeAttempts = BENCHMARK_PROMPTS.reduce(
        (sum, definition) => sum + promptJudges[definition.id].judge.attempts,
        0,
      );
      const judgeError =
        promptJudges.today.judge.error ??
        promptJudges.reviseSeason.judge.error ??
        null;
      const entry: JudgeScore = {
        id: result.id,
        score: combined.score,
        components: combined.components,
        note: combined.note,
        failed:
          combined.failed ||
          !result.ok ||
          promptJudges.today.judge.error !== null ||
          promptJudges.reviseSeason.judge.error !== null,
        gates,
        prompts: promptJudges,
        judge: {
          model: JUDGE_MODEL,
          attempts: judgeAttempts,
          timeMs: judgeTimeMs,
          costUsd: judgeCostUsd,
          error: judgeError,
        },
      };
      const existingIndex = scores.findIndex((score) => score.id === entry.id);
      if (existingIndex >= 0) scores[existingIndex] = entry;
      else scores.push(entry);
      completed += 1;
      console.log(
        `[${completed}/${results.length}] ${result.id} ${entry.score.toFixed(1)} ` +
          `(today ${promptJudges.today.score.toFixed(1)} · revision ${promptJudges.reviseSeason.score.toFixed(1)}) ` +
          `${entry.gates?.failures.length ? `gates failed: ${entry.gates.failures.join("; ")} ` : ""}` +
          `${((performance.now() - started) / 1000).toFixed(1)}s judge`,
      );
      await write();
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const totalJudgeCost = scores.reduce(
    (sum, score) => sum + score.judge.costUsd,
    0,
  );
  console.log(
    `judged ${scores.length}/${results.length}, judge cost $${totalJudgeCost.toFixed(4)}`,
  );
}

await main();
