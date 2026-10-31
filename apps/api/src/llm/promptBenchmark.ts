import type { LlmModelGrade } from "@killingit/shared";
import { GRADE_ORDER } from "./modelCatalog.js";

/** Dates used by the two benchmark prompts. */
export const TODAY_BENCHMARK_DATE = "2026-10-30";
export const REVISE_SEASON_DATE = "2026-10-31";
export const REVISE_WEEK_START = "2026-10-26";

/** The revision request returns exactly these top-level keys. */
export const REVISE_SEASON_TOP_LEVEL_KEYS = [
  "season",
  "block",
  "week",
  "today",
  "tomorrow",
  "nextWeek",
  "nextBlock",
  "bodyMetrics",
] as const;

export const BENCHMARK_PROMPTS = [
  {
    id: "today",
    label: "Today plan",
    file: "today-prompt.txt",
    maxTokens: 8_192,
    retryMaxTokens: 8_192,
  },
  {
    id: "reviseSeason",
    label: "Season revision",
    file: "revise-season-prompt.txt",
    maxTokens: 16_384,
    retryMaxTokens: 32_768,
  },
] as const;

export type BenchmarkPromptId = (typeof BENCHMARK_PROMPTS)[number]["id"];

export interface BenchmarkPromptDefinition {
  id: BenchmarkPromptId;
  label: string;
  file: string;
  maxTokens: number;
  retryMaxTokens: number;
}

export const BENCHMARK_COMPONENT_KEYS = [
  "contract",
  "fidelity",
  "design",
  "rationale",
  "grounding",
  "detail",
] as const;

const SESSION_TYPES = ["workout", "rest"];
const INTENSITIES = ["easy", "moderate", "hard", "rest"];
const SESSION_STATUSES = ["completed", "partial", "planned", "missed", "rest"];

export interface BlockWeekBaseline {
  number: number;
  startDate: string;
  focus: string;
  targetLoad: string;
  estimatedFtpWatts: number | null;
}

export interface BlockBaseline {
  name: string;
  focus: string;
  startDate: string;
  endDate: string;
  weeks: BlockWeekBaseline[];
}

export interface ReviseSeasonGates {
  atlasMentioned: boolean;
  blockOneChanged: boolean;
  blockOneStartDateKept: boolean;
  failures: string[];
}

export interface PromptScoreInput {
  score: number;
  components: Record<string, number>;
  note: string;
}

export interface CombinedPromptScore {
  score: number;
  components: Record<string, number>;
  failed: boolean;
  note: string;
}

export function parseAbilityGrade(value: string): LlmModelGrade | null {
  const normalized = value.trim().toUpperCase();
  return normalized in GRADE_ORDER ? (normalized as LlmModelGrade) : null;
}

export function filterByMinimumAbility<T extends { id: string }>(
  models: readonly T[],
  grades: ReadonlyMap<string, LlmModelGrade>,
  minimum: LlmModelGrade,
): T[] {
  const floor = GRADE_ORDER[minimum];
  return models.filter((model) => {
    const grade = grades.get(model.id);
    if (grade === undefined || grade === "?") return true;
    return GRADE_ORDER[grade] >= floor;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkField(
  record: Record<string, unknown>,
  key: string,
  type: "string" | "number" | "boolean" | "object" | "array",
  errors: string[],
  prefix: string,
): void {
  if (!(key in record)) {
    errors.push(`${prefix} missing field: ${key}`);
    return;
  }
  const value = record[key];
  if (type === "object") {
    if (value !== null && !isRecord(value)) {
      errors.push(`${prefix} ${key} must be null or an object`);
    }
    return;
  }
  if (type === "array") {
    if (!Array.isArray(value)) errors.push(`${prefix} ${key} must be an array`);
    return;
  }
  if (typeof value !== type) errors.push(`${prefix} ${key} must be a ${type}`);
}

function checkEnum(
  record: Record<string, unknown>,
  key: string,
  choices: string[],
  errors: string[],
  prefix: string,
): void {
  if (!(key in record)) return;
  if (!choices.includes(String(record[key]))) {
    errors.push(`${prefix} ${key} must be one of ${choices.join(", ")}`);
  }
}

function checkSessionFields(
  session: Record<string, unknown>,
  fields: Array<[string, "string" | "number" | "boolean" | "object" | "array"]>,
  errors: string[],
  prefix: string,
): void {
  for (const [key, type] of fields) {
    checkField(session, key, type, errors, prefix);
  }
  checkEnum(session, "type", SESSION_TYPES, errors, prefix);
  checkEnum(session, "intensity", INTENSITIES, errors, prefix);
  checkEnum(session, "status", SESSION_STATUSES, errors, prefix);
}

function checkNullableNumber(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
  prefix: string,
): void {
  if (!(key in record)) {
    errors.push(`${prefix} missing field: ${key}`);
    return;
  }
  const value = record[key];
  if (value !== null && typeof value !== "number") {
    errors.push(`${prefix} ${key} must be a number or null`);
  }
}

/** The single-day prompt returns a smaller session object than a plan update. */
function checkTodayBenchmarkSession(
  session: Record<string, unknown>,
  errors: string[],
  prefix: string,
): void {
  checkSessionFields(
    session,
    [
      ["date", "string"],
      ["status", "string"],
      ["title", "string"],
      ["type", "string"],
      ["intensity", "string"],
      ["durationMinutes", "number"],
      ["outdoor", "boolean"],
      ["canBeOutdoor", "boolean"],
      ["estimatedTss", "number"],
      ["estimatedFtpWatts", "number"],
      ["bikeWorkout", "object"],
      ["description", "string"],
      ["optional", "boolean"],
      ["optionalRationale", "string"],
    ],
    errors,
    prefix,
  );
}

function checkReviseTodaySession(
  session: Record<string, unknown>,
  errors: string[],
  prefix: string,
): void {
  checkSessionFields(
    session,
    [
      ["date", "string"],
      ["type", "string"],
      ["title", "string"],
      ["description", "string"],
      ["durationMinutes", "number"],
      ["intensity", "string"],
      ["status", "string"],
      ["alternatives", "array"],
      ["rationale", "string"],
      ["optional", "boolean"],
      ["optionalRationale", "string"],
      ["estimatedTss", "number"],
      ["outdoor", "boolean"],
      ["canBeOutdoor", "boolean"],
      ["bikeWorkout", "object"],
    ],
    errors,
    prefix,
  );
}

function checkWeekSession(
  session: Record<string, unknown>,
  errors: string[],
  prefix: string,
): void {
  checkSessionFields(
    session,
    [
      ["date", "string"],
      ["day", "string"],
      ["type", "string"],
      ["title", "string"],
      ["description", "string"],
      ["durationMinutes", "number"],
      ["intensity", "string"],
      ["status", "string"],
      ["estimatedTss", "number"],
      ["outdoor", "boolean"],
      ["canBeOutdoor", "boolean"],
      ["bikeWorkout", "object"],
    ],
    errors,
    prefix,
  );
  // A past day legitimately has no forward FTP projection.
  checkNullableNumber(session, "estimatedFtpWatts", errors, prefix);
}

function checkTopLevelKeys(
  root: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  errors: string[],
): void {
  const missing = required.filter((key) => !(key in root));
  if (missing.length > 0) {
    errors.push(`missing top-level keys: ${missing.join(", ")}`);
  }
  const allowed = new Set([...required, ...optional]);
  const extra = Object.keys(root).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    errors.push(`unexpected top-level keys: ${extra.join(", ")}`);
  }
  if ("coachQuestions" in root && !Array.isArray(root.coachQuestions)) {
    errors.push("coachQuestions must be an array");
  }
  if (
    "modelsRemarks" in root &&
    root.modelsRemarks !== null &&
    typeof root.modelsRemarks !== "string"
  ) {
    errors.push("modelsRemarks must be a string or null");
  }
}

/** Checks the single-day benchmark response. */
export function validateTodayPlan(plan: unknown): string[] {
  if (!isRecord(plan)) return ["response is not an object"];
  const errors: string[] = [];
  checkTopLevelKeys(
    plan,
    ["today"],
    ["coachQuestions", "modelsRemarks"],
    errors,
  );
  const today = plan.today;
  if (!isRecord(today)) return [...errors, "missing today object"];
  checkTodayBenchmarkSession(today, errors, "today:");
  if (today.date !== TODAY_BENCHMARK_DATE) {
    errors.push(`today date must be ${TODAY_BENCHMARK_DATE}`);
  }
  return errors;
}

/** Checks that the season revision has the requested shape before judging. */
export function validateReviseSeasonPlan(plan: unknown): string[] {
  if (!isRecord(plan)) return ["response is not an object"];
  const errors: string[] = [];
  checkTopLevelKeys(
    plan,
    REVISE_SEASON_TOP_LEVEL_KEYS,
    ["coachQuestions", "modelsRemarks"],
    errors,
  );

  const season = plan.season;
  if (!isRecord(season)) {
    errors.push("missing season object");
  } else {
    for (const key of ["goal", "rationale", "startDate", "endDate"]) {
      checkField(season, key, "string", errors, "season:");
    }
    if (!Array.isArray(season.blocks) || season.blocks.length === 0) {
      errors.push("season: blocks must be a non-empty array");
    } else {
      for (const [index, block] of season.blocks.entries()) {
        if (!isRecord(block)) {
          errors.push(`season: block ${index + 1} is not an object`);
          continue;
        }
        for (const key of ["name", "focus", "startDate", "endDate"]) {
          checkField(
            block,
            key,
            "string",
            errors,
            `season: block ${index + 1}:`,
          );
        }
        checkField(
          block,
          "weekCount",
          "number",
          errors,
          `season: block ${index + 1}:`,
        );
      }
    }
  }

  const block = plan.block;
  if (!isRecord(block)) {
    errors.push("missing block object");
  } else {
    for (const key of ["name", "focus", "rationale", "startDate", "endDate"]) {
      checkField(block, key, "string", errors, "block:");
    }
    if (!Array.isArray(block.weeks) || block.weeks.length === 0) {
      errors.push("block: weeks must be a non-empty array");
    } else {
      for (const [index, week] of block.weeks.entries()) {
        if (!isRecord(week)) {
          errors.push(`block: week ${index + 1} is not an object`);
          continue;
        }
        checkField(
          week,
          "number",
          "number",
          errors,
          `block: week ${index + 1}:`,
        );
        checkField(
          week,
          "startDate",
          "string",
          errors,
          `block: week ${index + 1}:`,
        );
        checkField(
          week,
          "focus",
          "string",
          errors,
          `block: week ${index + 1}:`,
        );
        checkField(
          week,
          "targetLoad",
          "string",
          errors,
          `block: week ${index + 1}:`,
        );
        checkNullableNumber(
          week,
          "estimatedFtpWatts",
          errors,
          `block: week ${index + 1}:`,
        );
      }
    }
  }

  const week = plan.week;
  const weekDates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${REVISE_WEEK_START}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
  if (!isRecord(week)) {
    errors.push("missing week object");
  } else {
    for (const key of ["startDate", "focus", "rationale"]) {
      checkField(week, key, "string", errors, "week:");
    }
    checkNullableNumber(week, "estimatedFtpWatts", errors, "week:");
    if (week.startDate !== REVISE_WEEK_START) {
      errors.push(`week startDate must be ${REVISE_WEEK_START}`);
    }
    if (!Array.isArray(week.sessions) || week.sessions.length !== 7) {
      errors.push("week: sessions must contain exactly seven sessions");
    } else {
      const dates = week.sessions.map((session) =>
        isRecord(session) ? String(session.date) : "",
      );
      if (dates.join(",") !== weekDates.join(",")) {
        errors.push(
          `week: sessions must cover ${weekDates[0]} through ${weekDates[6]}`,
        );
      }
      for (const [index, session] of week.sessions.entries()) {
        if (!isRecord(session)) {
          errors.push(`week: session ${index + 1} is not an object`);
          continue;
        }
        checkWeekSession(session, errors, `week: session ${index + 1}:`);
      }
    }
  }

  const today = plan.today;
  if (!isRecord(today)) {
    errors.push("missing today object");
  } else {
    checkReviseTodaySession(today, errors, "today:");
    if (today.date !== REVISE_SEASON_DATE) {
      errors.push(`today date must be ${REVISE_SEASON_DATE}`);
    }
    const sessions: unknown[] =
      isRecord(week) && Array.isArray(week.sessions)
        ? (week.sessions as unknown[])
        : [];
    const matching = sessions.find(
      (session) => isRecord(session) && session.date === REVISE_SEASON_DATE,
    );
    if (matching === undefined) {
      errors.push("today must be one of the week's sessions");
    } else if (isRecord(matching)) {
      for (const key of [
        "title",
        "type",
        "intensity",
        "durationMinutes",
        "status",
      ] as const) {
        if (matching[key] !== today[key]) {
          errors.push(
            `today ${key} must match the week's session on that date`,
          );
        }
      }
    }
  }

  // Tomorrow, nextWeek and nextBlock were supplied as null. A model that fills
  // them has broken the revision instruction, but the plan is still judgeable,
  // so fidelity marks it down instead of the validator rejecting the answer.
  if (!Array.isArray(plan.bodyMetrics)) {
    errors.push("bodyMetrics must be an array");
  }
  return errors;
}

/**
 * Reads the block that the revision prompt supplies as the current block. The
 * benchmark compares the answer against this block to detect an unchanged plan.
 */
export function parseCurrentBlock(prompt: string): BlockBaseline | null {
  const section = prompt
    .split("Current block plan:")[1]
    ?.split("Current week plan:")[0];
  if (!section) return null;
  const name = section.match(/^Block: (.+)$/m)?.[1]?.trim();
  const focus = section.match(/^Focus: (.+)$/m)?.[1]?.trim();
  const dates = section.match(
    /^Dates: (\d{4}-\d{2}-\d{2}) → (\d{4}-\d{2}-\d{2})/m,
  );
  if (!name || !focus || !dates) return null;
  const startDate = dates[1];
  const endDate = dates[2];
  if (!startDate || !endDate) return null;

  const weeks: BlockWeekBaseline[] = [];
  const pattern = /^- Week (\d+) \(from (\d{4}-\d{2}-\d{2})\): (.+)$/gm;
  for (const match of section.matchAll(pattern)) {
    const numberText = match[1];
    const weekStart = match[2];
    const body = match[3];
    if (!numberText || !weekStart || !body) continue;
    const ftpMatch = body.match(/; estimated FTP (\d+) W\s*$/);
    const withoutFtp =
      ftpMatch?.index === undefined ? body : body.slice(0, ftpMatch.index);
    const marker = "; target load: ";
    const markerIndex = withoutFtp.indexOf(marker);
    const weekFocus = (
      markerIndex >= 0 ? withoutFtp.slice(0, markerIndex) : withoutFtp
    ).trim();
    const targetLoad = (
      markerIndex >= 0 ? withoutFtp.slice(markerIndex + marker.length) : ""
    ).trim();
    weeks.push({
      number: Number(numberText),
      startDate: weekStart,
      focus: weekFocus,
      targetLoad,
      estimatedFtpWatts: ftpMatch?.[1] ? Number(ftpMatch[1]) : null,
    });
  }
  if (weeks.length === 0) return null;

  return { name, focus, startDate, endDate, weeks };
}

function baselineSignature(baseline: BlockBaseline): string {
  return JSON.stringify([
    baseline.focus,
    baseline.endDate,
    baseline.weeks.map((week) => [
      week.startDate,
      week.focus,
      week.targetLoad,
      week.estimatedFtpWatts,
    ]),
  ]);
}

function candidateBlockSignature(block: Record<string, unknown>): string {
  const weeks = Array.isArray(block.weeks)
    ? block.weeks.map((week) =>
        isRecord(week)
          ? [
              week.startDate,
              week.focus,
              week.targetLoad,
              week.estimatedFtpWatts,
            ]
          : null,
      )
    : null;
  return JSON.stringify([block.focus ?? null, block.endDate ?? null, weeks]);
}

/**
 * The three hard gates the revision benchmark applies to ability. A failed gate
 * grades the model F no matter what the judge thought of the plan.
 */
export function checkReviseSeasonGates(
  plan: unknown,
  baseline: BlockBaseline,
): ReviseSeasonGates {
  const text = JSON.stringify(plan)?.toLowerCase() ?? "";
  const atlasMentioned = text.includes("atlas");
  const root = isRecord(plan) ? plan : {};
  const block = isRecord(root.block) ? root.block : null;
  const season = isRecord(root.season) ? root.season : null;
  const seasonBlocks: unknown[] =
    season && Array.isArray(season.blocks) ? (season.blocks as unknown[]) : [];
  const firstSeasonBlock = seasonBlocks[0];
  const seasonStart = isRecord(firstSeasonBlock)
    ? firstSeasonBlock.startDate
    : undefined;
  const blockOneStartDateKept =
    block?.startDate === baseline.startDate &&
    seasonStart === baseline.startDate;
  const signature = block ? candidateBlockSignature(block) : null;
  const blockOneChanged =
    signature !== null && signature !== baselineSignature(baseline);

  const failures: string[] = [];
  if (!atlasMentioned) failures.push("the response never mentions Atlas");
  if (!blockOneChanged) failures.push("block 1 is unchanged");
  if (!blockOneStartDateKept) {
    failures.push(`block 1 does not start on ${baseline.startDate}`);
  }
  return {
    atlasMentioned,
    blockOneChanged,
    blockOneStartDateKept,
    failures,
  };
}

/**
 * Combines the two judged prompts into the model's benchmark result. The score
 * is the mean of both prompt scores; a component counts at its weaker value so
 * a failing component in either prompt still grades the model F.
 */
export function combinePromptScores(
  today: PromptScoreInput,
  revise: PromptScoreInput,
  gateFailures: readonly string[],
): CombinedPromptScore {
  const components: Record<string, number> = {};
  for (const key of BENCHMARK_COMPONENT_KEYS) {
    components[key] = Math.min(
      today.components[key] ?? 0,
      revise.components[key] ?? 0,
    );
  }
  const notes = [
    `Today plan: ${today.note}`,
    `Season revision: ${revise.note}`,
  ];
  if (gateFailures.length > 0) {
    notes.push(`Hard gates failed: ${gateFailures.join("; ")}.`);
  }
  return {
    score: Math.round(((today.score + revise.score) / 2) * 10) / 10,
    components,
    failed: gateFailures.length > 0,
    note: notes.join(" "),
  };
}
