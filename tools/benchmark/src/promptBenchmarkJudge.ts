import { resolve } from "node:path";
import {
  createOpenRouterProvider,
  type LlmProvider,
} from "../../../apps/api/src/llm/openrouter.js";
import {
  logPromptBenchmark,
  promptBenchmarkRunDirectory,
  readPromptJson,
  readPromptJsonOr,
  writePromptJson,
} from "./promptBenchmarkFiles.js";
import {
  BENCHMARK_PROMPTS,
  buildBenchmarkPromptMessages,
  formatBenchmarkPrompt,
  type BenchmarkPromptDefinition,
  type BenchmarkPromptId,
} from "./promptBenchmarkInput.js";
import {
  checkReviseSeasonGates,
  combinePromptScores,
  extractJson,
  parseCurrentBlock,
  parseJudge,
} from "./promptBenchmark.js";
import { completePrompt } from "./promptBenchmarkProvider.js";
import type {
  PromptAttempt,
  PromptJudge,
  PromptJudgeScore,
  PromptModelResult,
  PromptRunResult,
} from "./promptBenchmarkTypes.js";

const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "anthropic/claude-haiku-5.5";
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 4000);
const JUDGE_TIMEOUT_MS = 240_000;

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

1. contract (0-1.5): valid JSON with the top-level keys today, tomorrow, week, diet and bodyMetrics, and optionally coachQuestion and modelsRemarks. Today and tomorrow are complete day objects using the contract's field names and types; week has exactly seven dated sessions as short outlines; no prose around the JSON, no code fence. Extra fields inside an object are a minor issue, not a failure.

2. fidelity (0-2.0): the candidate matches the dates, statuses, session types, durations, intensities, indoor/outdoor flags, bikeWorkout, FTP and TSS stated in the original prompt and the current plan. Today must be 2026-10-30 and one of the week's sessions, tomorrow must be 2026-10-31, and the week must run from 2026-10-26 to 2026-11-01. Past days keep what the athlete actually did. The weekday sessions stay inside the athlete's after-work window and out of the dark, as the weekly note says. Marking today completed when no activity is recorded, inventing an activity, or replacing a planned session with an unrelated one loses points.

3. design (0-3.0): a specific, safe, well-sequenced session and week that fit the athlete's goals, experience, equipment, recent training and the current plan. Reward sensible exercise selection, sets and reps, rest, progression and safety. Penalize vague, generic or unsafe prescriptions. Do not require any particular exercise.

4. rationale (0-2.0): the day's rationale and optionalRationale explain why this session is right for the athlete now and what is lost by skipping. Reward specific, grounded reasoning tied to the athlete's goals and current plan. Penalize empty, generic or purely motivational text.

5. grounding (0-2.0): uses the athlete's actual profile, recent activities, comments, constraints and current plan; makes no invented claims; does not hallucinate a completed activity; respects the athlete's time, equipment, weather and daylight limits.

6. detail (0-2.0): extra, useful execution detail in the description. Reward load progression or RPE/rep-in-reserve guidance, technique cues, stop conditions, fallbacks or alternatives for missing equipment or pain, explicit assumptions for unknown loads, exercise-specific notes, and success criteria. Do not reward padding, repetition or irrelevant text. A concise plan can earn high detail if every extra sentence helps execution.

Return ONLY a JSON object in this exact shape:
{"contract": 0.0, "fidelity": 0.0, "design": 0.0, "rationale": 0.0, "grounding": 0.0, "detail": 0.0, "score": 0.0, "judgment": "2-4 specific sentences"}

The score is the sum of the six components (maximum 12.5), rounded to one decimal. The judgment should say what was strong and what was weak in this specific candidate.

Return strict JSON. Inside the judgment string, do not use quotation marks of any kind (no double quotes and no single quotes). Do not use raw newlines inside the judgment. Refer to field names and phrases without quoting them.`;

const REVISE_SEASON_RUBRIC = `You are a strict, expert endurance-coaching judge. You evaluate another model's answer to a coaching prompt. Do not answer the coaching prompt yourself and do not produce a training plan. Only evaluate the candidate JSON.

You will receive the exact original prompt given to the candidate and the candidate's JSON response. The original prompt asks the model to refresh an existing season plan after the athlete's stated goal changed: the next race is the Atlas Mountain Race on 28 February 2027, followed by Paris-Brest-Paris in August 2027, with a randonneur brevet series in between whose first event is a 200 km brevet in April 2027. The revision request says the season and the current block must be refreshed in place, block 1 must start on 2026-10-19, blocks that ended before today must stay as supplied, the remainder of the season must be re-planned as contiguous blocks that cover the season, the current week and today must be revised coherently, tomorrow, next week and next block must stay null because they were supplied as null, and the coaching survey adjustments must be applied.

A correct answer must mention Atlas, must produce a genuinely changed block 1, and must keep block 1 starting on 2026-10-19. Those three requirements are also checked mechanically, so their absence is already a hard failure; do not let strong writing hide it, and do not award credit for content the athlete did not supply.

An answer may instead ask a coachQuestion about Atlas rather than working Atlas into the plan. That is acceptable and must not be treated as a design, fidelity or grounding failure. It is better, however, if the revised plan itself includes Atlas preparation, the current (first) block has changed to accommodate Atlas, and there is no coachQuestion; reward that preferred outcome more highly than the question-only answer.

If the block plan in the output does not mention Atlas in its name, focus, or rationale, treat that as a strong hint that the model is not producing a good revised plan. A revised block that never names Atlas is weak evidence of Atlas preparation even when the season text mentions Atlas.

Score the candidate on these six components. Be strict but fair. Judge the coaching content, not writing style alone.

1. contract (0-1.5): valid JSON with exactly the nine top-level keys, season, block, week, today, tomorrow, nextWeek, nextBlock, diet and bodyMetrics, using the contract's field names and types, seven week sessions, a matching today session, and no prose or extra fields.

2. fidelity (0-2.0): follows every instruction in the revision request. The season is refreshed in place, block 1 starts on 2026-10-19, earlier blocks are untouched, later blocks tile the season with no gaps or overlaps through the season end, the current block is detailed, the current week is coherent with it, today is revised, and tomorrow, nextWeek and nextBlock stay null. It keeps dates, athlete goals and stored facts consistent.

3. design (0-3.0): the revised season makes sense as a response to the new goal. Reward a credible build to the Atlas Mountain Race on 28 February 2027, with a sane taper and recovery, while preserving Paris-Brest-Paris in August 2027, the April 200 km brevet and the intervening brevet series, respecting the athlete's admitted ceiling of about four months of disciplined training before needing a reset, the Norwegian winter, the two-hour weekday limit after work, longer weekend rides, cycling and strength training with skiing in winter and running otherwise, power targets on the bike and heart-rate targets elsewhere, and the 225 W FTP. Strongly prefer a block plan whose name, focus or rationale names Atlas. Penalise plans that ignore Atlas, keep the old season shape, overload or detrain the athlete, invent races or numbers, or break the chronological season logic.

4. rationale (2.0): specific, current, athlete-grounded reasons for the season shape, the block, its weeks and today. Each rationale explains the plan as it stands and why it fits the next races and the athlete's constraints. Penalise meta-commentary about adjusting, rewriting or replacing the old plan, and generic encouragement.

5. grounding (2.0): uses the supplied athlete profile, thresholds, activities, comments, weather and dates; invents no facts; reports bodyMetrics only for numbers the input states, so an empty array is correct here; keeps FTP and TSS consistent with the input; respects the athlete's time, equipment, daylight and weather constraints.

6. detail (2.0): concrete week targets and progression, a specific block plan, a coherent current week and useful execution detail for today. Reward realistic load, recovery and progression. Do not reward padding or repetition.

Return ONLY a JSON object in this exact shape:
{"contract": 0.0, "fidelity": 0.0, "design": 0.0, "rationale": 0.0, "grounding": 0.0, "detail": 0.0, "score": 0.0, "judgment": "2-4 specific sentences"}

The score is the sum of the six components (maximum 12.5), rounded to one decimal. The judgment should say what was strong and what was weak in this specific candidate.

Return strict JSON. Inside the judgment string, do not use quotation marks of any kind (no double quotes and no single quotes). Do not use raw newlines inside the judgment. Refer to field names and phrases without quoting them.`;

async function callJudge(
  provider: LlmProvider,
  apiKey: string,
  rubric: string,
  originalPrompt: string,
  candidate: unknown,
): Promise<PromptAttempt> {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const completion = await completePrompt(
    provider,
    {
      apiKey,
      model: JUDGE_MODEL,
      messages: [
        { role: "system", content: rubric },
        {
          role: "user",
          content: `## ORIGINAL PROMPT GIVEN TO THE CANDIDATE\n\n${originalPrompt}\n\n## CANDIDATE JSON RESPONSE\n\n${JSON.stringify(candidate, null, 2)}\n\nScore the candidate now. Return only the JSON scoring object.`,
        },
      ],
      temperature: 0,
      maxTokens: MAX_TOKENS,
    },
    JUDGE_TIMEOUT_MS,
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
    error:
      completion.error ??
      (parsed === null ? "judge response was not valid JSON" : null),
  };
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
  provider: LlmProvider,
  apiKey: string,
  definition: BenchmarkPromptDefinition,
  originalPrompt: string,
  result: PromptRunResult,
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
  const attempts: PromptAttempt[] = [];
  let judged: ReturnType<typeof parseJudge> = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const judgeAttempt = await callJudge(
      provider,
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

function isCurrentScore(value: unknown): value is PromptJudgeScore {
  if (typeof value !== "object" || value === null) return false;
  const score = value as Partial<PromptJudgeScore>;
  if (typeof score.prompts !== "object" || score.prompts === null) return false;
  return BENCHMARK_PROMPTS.every(
    (definition) => score.prompts?.[definition.id] !== undefined,
  );
}

/**
 * Judges the valid responses in a run directory. Judging is an optional stage:
 * the run itself only calls the models, so a review can stop after `run`.
 */
export async function runPromptBenchmarkJudgeStage(): Promise<void> {
  const apiKey = process.env.BENCHMARK_OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("BENCHMARK_OPENROUTER_API_KEY is not set");
  const runDirectory = promptBenchmarkRunDirectory();
  const provider = createOpenRouterProvider();
  const promptTexts = new Map<BenchmarkPromptId, string>();
  for (const definition of BENCHMARK_PROMPTS) {
    promptTexts.set(
      definition.id,
      formatBenchmarkPrompt(buildBenchmarkPromptMessages(definition.id)),
    );
  }
  const revisePrompt = promptTexts.get("reviseSeason");
  if (revisePrompt === undefined) {
    throw new Error("missing revise-season prompt");
  }
  const baseline = parseCurrentBlock(revisePrompt);
  if (baseline === null) {
    throw new Error(
      "could not read the supplied current block from the season revision prompt",
    );
  }

  const results = await readPromptJson<PromptModelResult[]>(
    resolve(runDirectory, "results.json"),
  );

  const outputPath = resolve(runDirectory, "judge-scores.json");
  const parsedScores = await readPromptJsonOr<unknown>(outputPath, []);
  const scores = Array.isArray(parsedScores)
    ? parsedScores.filter(isCurrentScore)
    : [];
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
  const expired = results.filter((result) => result.expired === true);
  const pending = results
    .filter((result) => result.expired !== true)
    .filter((result) => !done.has(result.id))
    .filter((result) => !onlyValid || result.ok)
    .slice(0, limit);
  logPromptBenchmark(
    `judging ${pending.length} models with ${JUDGE_MODEL} at ${BENCHMARK_PROMPTS.length} prompts ` +
      `(${done.size} already done, ${expired.length} left ungraded at the speed-F limit)`,
  );

  const concurrency = Math.max(1, Number(process.env.CONCURRENCY ?? 15));
  let cursor = 0;
  let completed = done.size;
  const write = async () => {
    await writePromptJson(outputPath, scores);
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
          provider,
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
      const entry: PromptJudgeScore = {
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
      logPromptBenchmark(
        `[${completed}/${results.length}] ${result.id} ${entry.score.toFixed(1)} ` +
          `(today ${promptJudges.today.score.toFixed(1)} · revision ${promptJudges.reviseSeason.score.toFixed(1)}) ` +
          `${entry.gates?.failures.length ? `gates failed: ${entry.gates.failures.join("; ")} ` : ""}` +
          `${((performance.now() - started) / 1000).toFixed(1)}s judge`,
      );
      await write();
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const totalJudgeCost = scores.reduce(
    (sum, score) => sum + score.judge.costUsd,
    0,
  );
  logPromptBenchmark(
    `judged ${scores.length}/${results.length}, judge cost $${totalJudgeCost.toFixed(4)}`,
  );
}
