import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const RUN_ID = process.env.RUN_ID ?? "2026-10-30-all-models";
const RUN_DIR = resolve(import.meta.dir, "runs", RUN_ID);
const PROMPT_PATH = resolve(import.meta.dir, "prompt.txt");
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "anthropic/claude-haiku-5.5";
const API_URL = "https://openrouter.ai/api/v1";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 15);
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 1500);

interface Attempt {
  timeMs: number;
  costUsd: number;
  raw: string;
  parsed: unknown | null;
  error: string | null;
}

interface ModelResult {
  id: string;
  name: string;
  attempts: Attempt[];
  retryNeeded: boolean;
  ok: boolean;
  totalTimeMs: number;
  totalCostUsd: number;
  plan: { today?: Record<string, unknown> } | null;
  validationErrors: string[];
}

interface JudgeScore {
  id: string;
  score: number;
  components: {
    contract: number;
    fidelity: number;
    design: number;
    rationale: number;
    grounding: number;
    detail: number;
  };
  note: string;
  judge: {
    model: string;
    attempts: number;
    timeMs: number;
    costUsd: number;
    error: string | null;
  };
}

const RUBRIC = `You are a strict, expert endurance-coaching judge. You evaluate another model's answer to a coaching prompt. Do not answer the coaching prompt yourself and do not produce a training plan. Only evaluate the candidate JSON.

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
  components: JudgeScore["components"];
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
  return {
    components: {
      contract: Math.max(0, Math.min(1.5, contract)),
      fidelity: Math.max(0, Math.min(2, fidelity)),
      design: Math.max(0, Math.min(3, design)),
      rationale: Math.max(0, Math.min(2, rationale)),
      grounding: Math.max(0, Math.min(2, grounding)),
      detail: Math.max(0, Math.min(2, detail)),
    },
    score:
      Math.round(
        (Math.max(0, Math.min(1.5, contract)) +
          Math.max(0, Math.min(2, fidelity)) +
          Math.max(0, Math.min(3, design)) +
          Math.max(0, Math.min(2, rationale)) +
          Math.max(0, Math.min(2, grounding)) +
          Math.max(0, Math.min(2, detail))) *
          10,
      ) / 10,
    note,
  };
}

async function callJudge(
  apiKey: string,
  originalPrompt: string,
  candidate: unknown,
): Promise<Attempt> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch(`${API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://killingit.local/benchmark",
        "X-Title": "Killingit today-prompt judge",
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        messages: [
          { role: "system", content: RUBRIC },
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

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const originalPrompt = await readFile(PROMPT_PATH, "utf8");
  const results = JSON.parse(
    await readFile(resolve(RUN_DIR, "results.json"), "utf8"),
  ) as ModelResult[];

  const outputPath = resolve(RUN_DIR, "judge-scores.json");
  let scores: JudgeScore[] = [];
  try {
    scores = JSON.parse(await readFile(outputPath, "utf8")) as JudgeScore[];
  } catch {
    scores = [];
  }
  const done = new Set(scores.map((score) => score.id));
  const limit = Number(process.env.LIMIT ?? Number.POSITIVE_INFINITY);
  const pending = results
    .filter((result) => !done.has(result.id))
    .slice(0, limit);
  console.log(
    `judging ${pending.length} models with ${JUDGE_MODEL} (${done.size} already done)`,
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
      const attempts: Attempt[] = [];
      let judged: ReturnType<typeof parseJudge> = null;

      if (!result.ok || result.plan === null) {
        const last = result.attempts.at(-1);
        const reason =
          last?.error ??
          last?.parseError ??
          result.validationErrors.join("; ") ??
          "no valid JSON";
        scores.push({
          id: result.id,
          score: 0,
          components: {
            contract: 0,
            fidelity: 0,
            design: 0,
            rationale: 0,
            grounding: 0,
            detail: 0,
          },
          note: `No valid JSON was returned after ${result.attempts.length} attempt(s), so there was no plan to judge: ${reason}.`,
          judge: {
            model: JUDGE_MODEL,
            attempts: 0,
            timeMs: 0,
            costUsd: 0,
            error: null,
          },
        });
      } else {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const judgeAttempt = await callJudge(
            apiKey,
            originalPrompt,
            result.plan,
          );
          attempts.push(judgeAttempt);
          if (judgeAttempt.parsed !== null) {
            judged = parseJudge(judgeAttempt.parsed);
            if (judged !== null) break;
          }
        }
        const judgeError =
          judged === null
            ? (attempts.at(-1)?.error ?? "judge did not return usable scores")
            : null;
        scores.push({
          id: result.id,
          score: judged?.score ?? 0,
          components: judged?.components ?? {
            contract: 0,
            fidelity: 0,
            design: 0,
            rationale: 0,
            grounding: 0,
            detail: 0,
          },
          note:
            judged?.note ??
            `The judge could not score this response: ${judgeError}.`,
          judge: {
            model: JUDGE_MODEL,
            attempts: attempts.length,
            timeMs: attempts.reduce((sum, attempt) => sum + attempt.timeMs, 0),
            costUsd: attempts.reduce(
              (sum, attempt) => sum + attempt.costUsd,
              0,
            ),
            error: judgeError,
          },
        });
      }

      completed += 1;
      const saved = scores.at(-1);
      console.log(
        `[${completed}/${results.length}] ${result.id} ${saved?.score.toFixed(1) ?? "?"} ` +
          `(${((performance.now() - started) / 1000).toFixed(1)}s judge)`,
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
