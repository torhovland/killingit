import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const RUN_ID = process.env.RUN_ID ?? "2026-10-30-all-models";
const RUN_DIR = resolve(import.meta.dir, "runs", RUN_ID);

interface Attempt {
  timeMs: number;
  httpStatus: number | null;
  finishReason: string | null;
  costUsd: number;
  raw: string;
  parsed: unknown | null;
  parseError: string | null;
  error: string | null;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  } | null;
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

interface Score {
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
  flags: string[];
  note: string;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

function stripCodeFence(raw: string): string {
  return raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function scoreModel(result: ModelResult): Score {
  const flags: string[] = [];
  const today = result.plan?.today ?? null;
  const raw = result.attempts.at(-1)?.raw ?? "";
  const rawTrimmed = raw.trim();
  const fenced = /^```/.test(rawTrimmed) || rawTrimmed.includes("```");
  const hasProse =
    rawTrimmed !== "" &&
    rawTrimmed !== stripCodeFence(rawTrimmed) &&
    !rawTrimmed.startsWith("{");

  // 1. Contract (2.0)
  let contract = 0;
  if (result.ok && today !== null) {
    contract += 1.0;
    if (!hasProse) contract += 0.25;
    else flags.push("extra prose around the JSON");
    if (Object.keys(result.plan ?? {}).length === 1) contract += 0.25;
    else flags.push("extra top-level keys");
    contract += 0.25;
    if (!fenced) contract += 0.25;
    else flags.push("JSON wrapped in a code fence");
  } else {
    flags.push("no valid JSON");
  }
  if (result.retryNeeded) flags.push("needed a retry");

  if (today === null) {
    const last = result.attempts.at(-1);
    const reason =
      last?.error ??
      last?.parseError ??
      result.validationErrors.join("; ") ??
      "no response";
    return {
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
      flags,
      note: `No valid JSON was returned after ${result.attempts.length} attempt(s): ${reason}.`,
    };
  }

  const title = String(today.title ?? "").toLowerCase();
  const description = String(today.description ?? "").toLowerCase();
  const optionalRationale = String(today.optionalRationale ?? "").toLowerCase();
  const text = `${title}\n${description}\n${optionalRationale}`;
  const status = String(today.status ?? "");
  const type = String(today.type ?? "");
  const intensity = String(today.intensity ?? "");
  const duration = Number(today.durationMinutes ?? 0);
  const tss = Number(today.estimatedTss ?? 0);
  const ftp = Number(today.estimatedFtpWatts ?? 0);

  // 2. Fidelity to the stored Friday session and contract semantics (2.0)
  let fidelity = 0;
  const fidelityChecks: Array<[boolean, number, string]> = [
    [String(today.date) === "2026-10-30", 0.2, "wrong date"],
    [type === "workout", 0.25, "type is not workout"],
    [intensity === "moderate", 0.2, "intensity is not moderate"],
    [duration >= 40 && duration <= 50, 0.25, "duration is not about 45 min"],
    [today.outdoor === false, 0.2, "outdoor flag is wrong for a gym session"],
    [
      today.canBeOutdoor === false,
      0.2,
      "canBeOutdoor is wrong for a gym session",
    ],
    [today.bikeWorkout === null, 0.2, "bikeWorkout should be null"],
    [status === "planned", 0.2, "status should be planned (no activity today)"],
    [ftp === 220, 0.2, "FTP estimate is not anchored at 220 W"],
    [
      tss >= 20 && tss <= 45,
      0.2,
      "TSS is implausible for a 45 min gym session",
    ],
  ];
  for (const [pass, weight, flag] of fidelityChecks) {
    if (pass) fidelity += weight;
    else flags.push(flag);
  }
  fidelity = clamp(fidelity, 0, 2);

  // 3. Session design (2.5)
  let design = 0;
  if (includesAny(title, ["gym", "strength", "lifting", "weights"]))
    design += 0.2;
  else flags.push("title does not name a gym/strength session");
  if (includesAny(title, ["b", "hinge", "posterior", "core", "stability"]))
    design += 0.15;
  if (description.length >= 500) design += 0.2;
  if (description.length >= 900) design += 0.15;
  if (description.length < 250) flags.push("description is thin");
  const setRepMatches = countMatches(
    description,
    /\b\d+\s*(?:x|×)\s*\d+\b|\b\d+\s*(?:sets?|reps?)\b/g,
  );
  if (setRepMatches >= 3) design += 0.3;
  else if (setRepMatches >= 1) design += 0.15;
  if (setRepMatches < 2) flags.push("lacks specific sets/reps");
  if (
    includesAny(description, [
      "rack pull",
      "trap-bar",
      "trap bar",
      "block pull",
      "elevated pull",
    ])
  )
    design += 0.3;
  else flags.push("no safe hinge progression");
  if (description.includes("split squat")) design += 0.2;
  else flags.push("no split squat");
  if (
    includesAny(description, [
      "90-120",
      "90–120",
      "90 to 120",
      "2 min",
      "two min",
      "120 s",
      "90 s",
    ])
  )
    design += 0.2;
  if (includesAny(description, ["pallof", "plank", "core"])) design += 0.15;
  if (includesAny(description, ["mobility", "stretch", "hip"])) design += 0.15;
  if (
    includesAny(description, [
      "flat back",
      "neutral spine",
      "form",
      "reserve",
      "controlled",
      "stop the set",
      "pain-free",
    ])
  )
    design += 0.2;
  const dangerous =
    /(?:heavy|barbell|loaded)\s+(?:deadlift|good morning|back squat)/.test(
      description,
    ) && !/(avoid|not|instead|replace|skip|without)/.test(description);
  if (!dangerous) design += 0.3;
  else flags.push("prescribes a risky heavy hinge/squat for this athlete");
  design = clamp(design, 0, 2.5);

  // 4. Rationale and skip cost (2.0)
  let rationale = 0;
  if (today.optional === false) rationale += 0.2;
  else flags.push("marked optional without a small skip cost");
  if (optionalRationale.length >= 150) rationale += 0.15;
  if (optionalRationale.length >= 300) rationale += 0.1;
  if (optionalRationale.length < 80)
    flags.push("optionalRationale is too short");
  if (
    includesAny(optionalRationale, [
      "skip",
      "missing",
      "lose",
      "loss",
      "cost",
      "without",
      "miss",
    ])
  )
    rationale += 0.35;
  else flags.push("does not state the cost of skipping");
  if (
    includesAny(optionalRationale, [
      "season",
      "paris-brest",
      "pbp",
      "2027",
      "5k",
      "brevet",
      "long-term",
      "goal",
    ])
  )
    rationale += 0.25;
  if (
    includesAny(optionalRationale, ["block", "autumn re-entry", "foundation"])
  )
    rationale += 0.2;
  if (
    /(?:\d+(?:\.\d+)?\s*(?:–|-|to)?\s*\d*\.?\d*\s*(?:h|hours?|tss))|target load|weekly target/.test(
      optionalRationale,
    )
  )
    rationale += 0.25;
  else flags.push("does not tie the session to the week's target load");
  if (
    includesAny(optionalRationale, [
      "hinge",
      "posterior",
      "back",
      "core",
      "strength",
      "sit bone",
      "climb",
      "posture",
      "fat loss",
    ])
  )
    rationale += 0.3;
  else flags.push("skip cost is generic");
  if (
    includesAny(description, [
      "assume",
      "assuming",
      "assumption",
      "conservative start",
      "if you cannot",
      "if not available",
      "if the gym",
      "because your",
      "not recorded",
      "not established",
      "start light",
    ])
  )
    rationale += 0.2;
  else flags.push("does not state a conservative assumption for unknown loads");
  if (
    includesAny(optionalRationale, [
      "improve fitness",
      "stay active",
      "feel better",
      "general health",
    ]) &&
    !includesAny(optionalRationale, ["hinge", "posterior", "back", "core"])
  )
    rationale -= 0.2;
  rationale = clamp(rationale, 0, 2);

  // 5. Grounding and safety (1.5)
  let grounding = 0;
  if (
    includesAny(text, [
      "detrain",
      "re-entry",
      "reentry",
      "fat loss",
      "fat-loss",
      "hunger",
      "calorie",
      "weight",
    ])
  )
    grounding += 0.3;
  if (
    includesAny(text, [
      "tuesday",
      "goblet",
      "quad",
      "row",
      "run/walk",
      "hike",
      "ankle",
      "split squat",
      "rack pull",
    ])
  )
    grounding += 0.3;
  else flags.push("little use of the athlete's recent context");
  if (
    includesAny(text, [
      "back",
      "lower back",
      "spine",
      "posture",
      "sit bone",
      "climb",
    ])
  )
    grounding += 0.3;
  else flags.push("does not connect to the athlete's back/posture goal");
  if (ftp === 220) grounding += 0.2;
  if (!hasProse) grounding += 0.2;
  if (!dangerous) grounding += 0.2;
  if (
    includesAny(text, ["outdoor", "rain", "weather"]) &&
    today.outdoor === true
  )
    grounding -= 0.3;
  const inventedCompletion =
    status === "completed" ||
    status === "partial" ||
    /you (?:have )?completed|completed (?:today|this)|you did (?:this|today)/.test(
      description,
    );
  if (inventedCompletion) {
    flags.push("invented a completed activity that is not in the input");
    grounding -= 0.6;
  }
  grounding = clamp(grounding, 0, 1.5);

  // 6. Extra, useful detail in the description (2.0)
  let detail = 0;
  const timedBlocks =
    countMatches(description, /\b\d+\s*(?:min|minutes?)\b/g) >= 3 &&
    includesAny(description, [
      "warm-up",
      "warm up",
      "main",
      "cool-down",
      "cool down",
    ]);
  if (timedBlocks) detail += 0.3;
  else flags.push("description has no timed structure");

  const warmUpSection =
    description.split(/main|strength|workout|exercises/)[0] ?? "";
  const warmUpDrills = [
    "cat-cow",
    "bird dog",
    "glute bridge",
    "hip hinge",
    "leg swing",
    "hip circle",
    "dead bug",
    "bodyweight squat",
    "treadmill",
    "bike",
    "rower",
    "stair",
  ].filter((term) => warmUpSection.includes(term)).length;
  if (warmUpDrills >= 2) detail += 0.2;

  const coolDownDetail = [
    "couch stretch",
    "forward fold",
    "90/90",
    "figure-4",
    "mobility circuit",
    "hip flexor",
    "hamstring stretch",
  ].filter((term) => description.includes(term)).length;
  if (coolDownDetail >= 1) detail += 0.2;

  const loadProgression =
    includesAny(description, ["rpe", "reserve", "rir"]) &&
    includesAny(description, [
      "add",
      "increase",
      "progress",
      "start",
      "working set",
    ]);
  if (loadProgression) detail += 0.3;

  const techniqueCues = [
    "flat back",
    "hips back",
    "brace",
    "shins",
    "ribs",
    "drive through",
    "knee track",
    "torso",
    "neutral spine",
    "glutes",
  ].filter((term) => description.includes(term)).length;
  if (techniqueCues >= 2) detail += 0.2;

  if (
    /stop (?:the set|if|any)|sharp pain|painful|form breaks|back rounds|rounding|lower-back strain/.test(
      description,
    )
  )
    detail += 0.2;

  if (
    includesAny(description, [
      "instead",
      "if you cannot",
      "if not available",
      "substitute",
      "fallback",
      "if the gym",
      "if time runs short",
    ])
  )
    detail += 0.2;

  if (
    includesAny(description, [
      "assume",
      "assuming",
      "assumption",
      "unknown",
      "not recorded",
      "not established",
      "conservative start",
    ])
  )
    detail += 0.2;

  if (
    includesAny(description, [
      "protein",
      "snack",
      "hunger",
      "fuel",
      "cottage cheese",
      "yoghurt",
      "yogurt",
    ])
  )
    detail += 0.1;

  if (
    includesAny(description, [
      "finish feeling",
      "should feel",
      "success criteria",
      "expected effort",
      "should finish",
    ])
  )
    detail += 0.1;

  detail = clamp(detail, 0, 2);

  const total =
    contract * 0.75 +
    fidelity +
    design * 0.8 +
    rationale * 0.75 +
    grounding * (2 / 3) +
    detail;

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  if (result.ok) strengths.push("valid JSON");
  if (fidelity >= 1.8)
    strengths.push("faithful to the planned Friday gym session");
  if (design >= 2.0)
    strengths.push("specific, back-safe strength prescription");
  if (rationale >= 1.5)
    strengths.push("clear skip cost tied to the athlete's goals");
  if (grounding >= 1.2)
    strengths.push(
      "well grounded in recent training and the back/posture goal",
    );
  if (detail >= 1.6) strengths.push("rich in useful extra detail");
  if (fidelity < 1.2) weaknesses.push("deviates from the stored session");
  if (design < 1.5) weaknesses.push("weak exercise detail");
  if (rationale < 1.2) weaknesses.push("generic or incomplete rationale");
  if (grounding < 0.9)
    weaknesses.push("limited grounding in the athlete context");
  if (detail < 0.8) weaknesses.push("sparse workout description");
  if (inventedCompletion)
    weaknesses.push("hallucinated that today's session was already completed");
  if (result.retryNeeded) weaknesses.push("needed a retry");

  const noteParts: string[] = [];
  if (strengths.length > 0) {
    noteParts.push(
      `${strengths
        .slice(0, 3)
        .join(", ")
        .replace(/^./, (c) => c.toUpperCase())}.`,
    );
  }
  if (weaknesses.length > 0) {
    noteParts.push(`Weaknesses: ${weaknesses.slice(0, 3).join("; ")}.`);
  }
  if (flags.length > 0 && weaknesses.length === 0) {
    noteParts.push(`Minor issues: ${flags.slice(0, 3).join("; ")}.`);
  }

  return {
    id: result.id,
    score: Math.round(total * 10) / 10,
    components: {
      contract: Math.round(contract * 0.75 * 10) / 10,
      fidelity: Math.round(fidelity * 10) / 10,
      design: Math.round(design * 0.8 * 10) / 10,
      rationale: Math.round(rationale * 0.75 * 10) / 10,
      grounding: Math.round(grounding * (2 / 3) * 10) / 10,
      detail: Math.round(detail * 10) / 10,
    },
    flags,
    note: noteParts.join(" ") || "No usable coaching content.",
  };
}

async function main(): Promise<void> {
  const results = JSON.parse(
    await readFile(resolve(RUN_DIR, "results.json"), "utf8"),
  ) as ModelResult[];
  const scores = results.map((result) => scoreModel(result));
  await writeFile(
    resolve(RUN_DIR, "scores.json"),
    `${JSON.stringify(scores, null, 2)}\n`,
  );
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  console.log(`scored ${scores.length} models`);
  for (const score of sorted.slice(0, 25)) {
    console.log(
      `${score.score.toFixed(1)} ${score.id} ` +
        `(C${score.components.contract} F${score.components.fidelity} D${score.components.design} R${score.components.rationale} G${score.components.grounding} X${score.components.detail})`,
    );
  }
}

await main();
