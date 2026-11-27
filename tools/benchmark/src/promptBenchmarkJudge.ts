import { resolve } from "node:path";
import {
  createOpenRouterProvider,
  type LlmProvider,
} from "../../../apps/api/src/llm/openrouter.js";
import { readJsonEntries, readJsonFile, writeJsonFile } from "./jsonFile.js";
import {
  logPromptBenchmark,
  promptBenchmarkRunDirectory,
} from "./promptBenchmarkFiles.js";
import {
  BENCHMARK_PROMPTS,
  buildBenchmarkPromptMessages,
  formatBenchmarkPrompt,
  type BenchmarkPromptDefinition,
  type BenchmarkPromptId,
} from "./promptBenchmarkInput.js";
import {
  averagePromptJudges,
  checkReviseSeasonGates,
  combinePromptScores,
  extractJson,
  parseCurrentBlock,
  parseJudge,
} from "./promptBenchmark.js";
import { completePrompt } from "./promptBenchmarkProvider.js";
import {
  promptJudgeScoreSchema,
  promptModelResultSchema,
  type PromptAttempt,
  type PromptJudge,
  type PromptJudgeScore,
  type PromptRunResult,
} from "./promptBenchmarkTypes.js";

const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "anthropic/claude-haiku-5.5";
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 4000);
const JUDGE_TIMEOUT_MS = 240_000;
const JUDGE_PASSES = Math.max(
  1,
  Math.floor(Number(process.env.JUDGE_PASSES ?? 1)),
);

const ZERO_COMPONENTS = {
  contract: 0,
  fidelity: 0,
  design: 0,
  rationale: 0,
  grounding: 0,
  detail: 0,
};

const REVISE_SEASON_RUBRIC = `You are a strict, expert endurance-coaching judge. You evaluate another model's answer to a coaching prompt. Do not answer the coaching prompt yourself and do not produce a training plan. Only evaluate the candidate JSON.

You will receive the exact original prompt given to the candidate and the candidate's JSON response. The original prompt asks the model to refresh an existing season plan after the athlete's stated goal changed: the next race is the Atlas Mountain Race on 28 February 2027, followed by Paris-Brest-Paris in August 2027, with a randonneur brevet series in between whose first event is a 200 km brevet in April 2027. The revision request says the season and the current block must be refreshed in place, block 1 must start on 2026-10-19, blocks that ended before today must stay as supplied, the remainder of the season must be re-planned as contiguous blocks that cover the season, the current week and today must be revised coherently, tomorrow, next week and next block must stay null because they were supplied as null, and the coaching survey adjustments must be applied.

A correct answer must mention Atlas, must produce a genuinely changed block 1, and must keep block 1 starting on 2026-10-19. Those three requirements are also checked mechanically, so their absence is already a hard failure; do not let strong writing hide it, and do not award credit for content the athlete did not supply.

An answer may instead ask a coachQuestion about Atlas rather than working Atlas into the plan. That is acceptable and must not be treated as a design, fidelity or grounding failure. It is better, however, if the revised plan itself includes Atlas preparation, the current (first) block has changed to accommodate Atlas, and there is no coachQuestion; reward that preferred outcome more highly than the question-only answer.

If the block plan in the output does not mention Atlas in its name, focus, or rationale, treat that as a strong hint that the model is not producing a good revised plan. A revised block that never names Atlas is weak evidence of Atlas preparation even when the season text mentions Atlas.

Score the candidate on these six components. Be strict but fair. Judge the coaching content, not writing style alone.

1. contract (0-1.5): valid JSON with exactly the nine top-level keys, season, block, week, today, tomorrow, nextWeek, nextBlock, diet and bodyMetrics, using the contract's field names and types, seven week sessions, a matching today session, and no prose or extra fields. The season carries a goals array with title, date, priority and target, and every season block and the detailed block carry subGoals with goalTitle, goalDate, role, target and byDate.

2. fidelity (0-2.0): follows every instruction in the revision request. The season is refreshed in place, block 1 starts on 2026-10-19, earlier blocks are untouched, later blocks tile the season with no gaps or overlaps through the season end, the current block is detailed, the current week is coherent with it, today is revised, and tomorrow, nextWeek and nextBlock stay null. It keeps dates, athlete goals and stored facts consistent.

3. design (0-3.0): the revised season makes sense as a response to the new goal. Reward a credible build to the Atlas Mountain Race on 28 February 2027, with a sane taper and recovery, while preserving Paris-Brest-Paris in August 2027, the April 200 km brevet and the intervening brevet series, respecting the athlete's admitted ceiling of about four months of disciplined training before needing a reset, the Norwegian winter, the two-hour weekday limit after work, longer weekend rides, cycling and strength training with skiing in winter and running otherwise, power targets on the bike and heart-rate targets elsewhere, and the 225 W FTP. Strongly prefer a block plan whose name, focus or rationale names Atlas. The goal ledger must keep every future goal accounted for, not only Atlas: a block may build Atlas while maintaining the qualities PBP and the brevets need, and the sub-goals must say which is which. Penalise plans that ignore Atlas, keep the old season shape, drop a future goal from the ledger, overload or detrain the athlete, invent races or numbers, or break the chronological season logic.

4. rationale (2.0): specific, current, athlete-grounded reasons for the season shape, the block, its weeks and today. Each rationale explains the plan as it stands and why it fits the next races and the athlete's constraints. Penalise meta-commentary about adjusting, rewriting or replacing the old plan, and generic encouragement.

5. grounding (2.0): uses the supplied athlete profile, thresholds, activities, comments, weather and dates; invents no facts; reports bodyMetrics only for numbers the input states, so an empty array is correct here; keeps FTP and TSS consistent with the input; respects the athlete's time, equipment, daylight and weather constraints.

6. detail (2.0): concrete week targets and progression, a specific block plan, a coherent current week and useful execution detail for today. Reward realistic load, recovery and progression. Do not reward padding or repetition.

Return ONLY a JSON object in this exact shape:
{"contract": 0.0, "fidelity": 0.0, "design": 0.0, "rationale": 0.0, "grounding": 0.0, "detail": 0.0, "score": 0.0, "judgment": "2-4 specific sentences"}

The score is the sum of the six components (maximum 12.5), rounded to one decimal. The judgment should say what was strong and what was weak in this specific candidate.

Return strict JSON. Inside the judgment string, do not use quotation marks of any kind (no double quotes and no single quotes). Do not use raw newlines inside the judgment. Refer to field names and phrases without quoting them.`;

const GOAL_STEERING_RUBRIC = `You are a strict, expert endurance-coaching judge. You evaluate another model's answer to a coaching prompt. Do not answer the coaching prompt yourself and do not produce a training plan. Only evaluate the candidate JSON.

You will receive the exact original prompt given to the candidate and the candidate's JSON response. The prompt is a Sunday refresh from a full-season simulation. The athlete is a 50-year-old, 85 kg man in Trondheim, seven weeks from a 100 km gravel race with 1170 m of climbing that he has said he wants to finish in 3:10:00 or faster. His current FTP is about 247 W and his CTL is about 31.5. His own prior 3:20 on the same course was ridden at an FTP of about 285 W five years ago. Assuming comparable group or solo conditions, 3:10 needs at least 280 W and should be compared with that 285 W prior; 281 W from the harness model is a floor, not a comfortable target. The stated 285 W FTP from the prior period is enough to anchor the prior result: do not accept a claim that the data is insufficient to estimate the demand. A build target of 252 W is not a plan for 3:10, and an interim training milestone does not replace the goal-required target. He has completed every prescribed session, but the stored block is only prescribing about 215-280 TSS a week and he says every workout felt easy and he was ready for more. He has said he can train 8-10 hours a week. The current block must keep its start date, 2027-06-21. The stored season carries a structured goal ledger with the 2027-05-23 half marathon already past and the 2027-08-22 gravel race still ahead; the stored gravel block carries a modest sub-goal target of a 3 hour long ride and 252 W FTP. The half marathon is history, so the gravel goal is the only one still ahead.

A good answer recognises the gap rather than repeating the target, says plainly whether 3:10 is realistic from here and what is realistic, and uses the athlete's capacity to prescribe the most productive safe build: a materially bigger block and week, at least one long gravel-specific ride, sustained climbing or threshold work at a real intensity, and enough recovery. It must also revise the structured goal ledger: keep the gravel goal and raise the block's sub-goal target so the plan closes the gap rather than repeating the timid 3 hour/252 W target. It may conclude that 3:10 is out of reach and aim for the closest realistic time, but it must not silently keep the same timid load or the same timid sub-goal, and it must not claim 3:10 is assured without evidence.

Score the candidate on these six components. Be strict but fair. Judge the coaching content, not writing style alone.

1. contract (0-1.5): valid JSON with the top-level keys season, block, week, today, tomorrow, nextWeek, diet and bodyMetrics, and optionally coachQuestion and modelsRemarks, using the contract's field names and types. The season has a goals array whose entries carry title, date, priority and target; every season block and the detailed block carry a subGoals array whose entries carry goalTitle, goalDate, role (build, maintain or accept-decline), target and byDate. The week has exactly seven dated sessions, the block has weeks, today and tomorrow are complete day objects, and there is no prose around the JSON or extra top-level fields.

2. fidelity (0-2.0): follows the revision request and the supplied plan. The current block keeps its start date 2027-06-21; its end date and the following block boundaries should stay unless the answer gives a specific, coherent reason to move them, so an unexplained one-day shift is a minor issue rather than a structural failure. The revised season keeps the goal ledger coherent: the gravel goal remains listed and the block's subGoals match the season block summary. A response that drops the ledger, invents a goal, or leaves the gravel goal unaccounted for breaks fidelity. The current week runs 2027-06-28 through 2027-07-04 and keeps the past days as the athlete actually completed them; today is 2027-07-04 and matches its week session; tomorrow is 2027-07-05 and is one of next week's sessions; next week starts 2027-07-05 and covers seven days; the completed days are not turned into invented activities or missed sessions. A response that returns null for tomorrow or next week breaks the request.

3. design (0-3.0): the plan is the best safe response to the gap. A week that still totals roughly 210-280 TSS with no harder or longer work is the same timid prescription that created the problem, so it scores at most 1.0 however well written. Reward a credible build week in roughly the 350-500 TSS range, or a clear reason why the athlete should not go that high, with a long gravel-specific ride (about three hours or more) and one purposeful sustained-power or climbing session. The revised block must show a real progression through the remaining weeks, not the same target loads, and its sub-goal target must be material: the stored 3 hour/252 W target is the timid plan that created the problem, so a build sub-goal below 280 W scores at most 1.0. This includes a "training milestone" target such as 252 W that leaves the goal-required 280 W out of the build sub-goal. Reward a sub-goal of at least 280 W, ideally around 285 W or more, with a byDate inside the block, and a derivation from the prior 3:20 at 285 W. A test is optional, not required: if the candidate schedules one, reward it only when it answers a question the plan depends on and is embedded in a productive workout; penalise a test added on top of an already hard week or forced into a taper.
Penalise unsafe spikes, junk volume, sessions the athlete's history does not support, and a plan that ignores the 8-10 hour capacity without explanation.

4. rationale (0-2.0): the week and block rationales state the goal situation explicitly, using the current FTP, the target time, the time remaining, the prior 3:20 at 285 W and the athlete's recent training, and name the block sub-goal the week advances. Reward a clear derivation of the power 3:10 needs — at least 280 W and normally around or above the 285 W prior — and a statement that the goal is at risk or out of reach and what would have to change, or a credible case that the new load closes the gap. Merely calling the target ambitious is weak. Penalise vague encouragement, restating the target as if it were a plan, and meta-commentary about revising the plan.

5. grounding (0-2.0): uses the supplied numbers and feedback: FTP around 247 W, CTL around 31.5, 8-10 hours available, a completed week of about 214 TSS where every session felt easy, the 2027-08-22 race date and the 1170 m of climbing. It invents no races, injuries, measurements or completed sessions and does not claim the athlete has done more than the input shows.

6. detail (0-2.0): concrete execution detail in the sessions: durations, intensities or power/heart-rate targets, interval structure, fuelling and pacing for the long ride, recovery and fallbacks. If a test is prescribed, it names the protocol, target and decision rule. Reward specifics that make the week executable and that visibly raise the stimulus. Do not reward padding, repetition or numbers that contradict the plan.

Return ONLY a JSON object in this exact shape:
{"contract": 0.0, "fidelity": 0.0, "design": 0.0, "rationale": 0.0, "grounding": 0.0, "detail": 0.0, "score": 0.0, "judgment": "2-4 specific sentences"}

The score is the sum of the six components (maximum 12.5), rounded to one decimal. The judgment should say what was strong and what was weak in this specific candidate.

Return strict JSON. Inside the judgment string, do not use quotation marks of any kind (no double quotes and no single quotes). Do not use raw newlines inside the judgment. Refer to field names and phrases without quoting them.`;

const PROMPT_RUBRICS = {
  reviseSeason: REVISE_SEASON_RUBRIC,
  goalSteering: GOAL_STEERING_RUBRIC,
} as const;

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

  const rubric = PROMPT_RUBRICS[definition.id];
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

  const results = await readJsonFile(
    resolve(runDirectory, "results.json"),
    promptModelResultSchema.array(),
  );

  const outputPath = resolve(runDirectory, "judge-scores.json");
  const scores = await readJsonEntries(outputPath, promptJudgeScoreSchema);
  const retryFailedJudges = process.env.RETRY_FAILED_JUDGES === "1";
  const done = new Set(
    scores
      .filter(
        (score) =>
          !retryFailedJudges ||
          BENCHMARK_PROMPTS.every(
            (definition) => score.prompts[definition.id]?.judge.error === null,
          ),
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
      `and ${JUDGE_PASSES} pass${JUDGE_PASSES === 1 ? "" : "es"} ` +
      `(${done.size} already done, ${expired.length} left ungraded at the speed-F limit)`,
  );

  const concurrency = Math.max(1, Number(process.env.CONCURRENCY ?? 15));
  let cursor = 0;
  let completed = done.size;
  const write = async () => {
    await writeJsonFile(outputPath, scores);
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
        const promptResult = result.prompts[definition.id];
        if (promptResult === undefined) {
          throw new Error(
            `missing ${definition.id} result for ${result.id}; run the run stage again before judging`,
          );
        }
        const passes: PromptJudge[] = [];
        for (let pass = 0; pass < JUDGE_PASSES; pass += 1) {
          passes.push(
            await judgePrompt(
              provider,
              apiKey,
              definition,
              originalPrompt,
              promptResult,
            ),
          );
        }
        promptJudges[definition.id] = averagePromptJudges(passes);
      }

      const gates = checkReviseSeasonGates(
        result.prompts.reviseSeason?.plan ?? null,
        baseline,
      );
      const combined = combinePromptScores(promptJudges, gates.failures);
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
        BENCHMARK_PROMPTS.map(
          (definition) => promptJudges[definition.id].judge.error,
        ).find((error) => error !== null) ?? null;
      const entry: PromptJudgeScore = {
        id: result.id,
        score: combined.score,
        components: combined.components,
        note: combined.note,
        failed:
          combined.failed ||
          !result.ok ||
          BENCHMARK_PROMPTS.some(
            (definition) => promptJudges[definition.id].judge.error !== null,
          ),
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
          `(revision ${promptJudges.reviseSeason.score.toFixed(1)} · goal ${promptJudges.goalSteering.score.toFixed(1)}) ` +
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
