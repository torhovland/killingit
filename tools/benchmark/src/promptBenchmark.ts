import { weekDates, type LlmModelGrade } from "@killingit/shared";
import { GRADE_ORDER } from "../../../apps/api/src/llm/modelCatalog.js";
import {
  BENCHMARK_PROMPTS,
  GOAL_STEERING_TOP_LEVEL_KEYS,
  GRADED_BENCHMARK_PROMPT_IDS as GRADED_PROMPT_IDS,
  REVISE_SEASON_DATE,
  REVISE_SEASON_TOP_LEVEL_KEYS,
  REVISE_WEEK_START,
  type BenchmarkPromptId,
} from "./promptBenchmarkInput.js";
import {
  GOAL_STEERING_NEXT_WEEK_START,
  GOAL_STEERING_TODAY,
  GOAL_STEERING_WEEK_START,
} from "./promptBenchmarkSeasonFixture.js";
import type {
  PromptJudge,
  PromptModelResult,
  ReviseSeasonGates,
} from "./promptBenchmarkTypes.js";

const BENCHMARK_COMPONENT_KEYS = [
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
const GOAL_PRIORITIES = ["A", "B", "C"];
const SUB_GOAL_ROLES = ["build", "maintain", "accept-decline"];
/**
 * Contract errors that only describe an extra or unexpected key. A response
 * with one of these is still recoverable in the `finalize` stage.
 */
const WARNING_LEVEL_ERROR_PREFIXES = [
  "unexpected root keys",
  "unexpected top-level keys",
];

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

export function filterByCostGrades<T extends { id: string }>(
  models: readonly T[],
  grades: ReadonlyMap<string, LlmModelGrade>,
  allowed: ReadonlySet<LlmModelGrade>,
): T[] {
  return models.filter((model) => {
    const grade = grades.get(model.id);
    return grade !== undefined && allowed.has(grade);
  });
}

/** Orders models by their previous benchmark time, slowest first. */
export function sortByPreviousTime<T extends { id: string }>(
  models: readonly T[],
  times: ReadonlyMap<string, number | null>,
): T[] {
  return [...models].sort((a, b) => {
    const aTime = times.get(a.id) ?? null;
    const bTime = times.get(b.id) ?? null;
    if (aTime === null && bTime === null) return a.id.localeCompare(b.id);
    if (aTime === null) return 1;
    if (bTime === null) return -1;
    if (aTime !== bTime) return bTime - aTime;
    return a.id.localeCompare(b.id);
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

/** The concrete workout or rest day the day contract requires. */
function checkDaySession(
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
      ["estimatedCaloriesKcal", "number"],
      ["calorieBreakdown", "object"],
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
      ["estimatedCaloriesKcal", "number"],
      ["calorieBreakdown", "object"],
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

/** Checks a week plan: its dates, its rationale and its seven sessions. */
function checkWeekPlan(
  week: Record<string, unknown>,
  startDate: string,
  errors: string[],
  prefix: string,
): void {
  for (const key of ["startDate", "focus", "rationale"]) {
    checkField(week, key, "string", errors, prefix);
  }
  checkNullableNumber(week, "estimatedFtpWatts", errors, prefix);
  if (week.startDate !== startDate) {
    errors.push(`${prefix} startDate must be ${startDate}`);
  }
  if ("dietProgress" in week) {
    checkField(week, "dietProgress", "object", errors, prefix);
  }
  if (!Array.isArray(week.sessions) || week.sessions.length !== 7) {
    errors.push(`${prefix} sessions must contain exactly seven sessions`);
    return;
  }
  const dates = week.sessions.map((session) =>
    isRecord(session) ? String(session.date) : "",
  );
  const expected = weekDates(startDate);
  if (dates.join(",") !== expected.join(",")) {
    errors.push(
      `${prefix} sessions must cover ${expected[0]} through ${expected[expected.length - 1]}`,
    );
  }
  for (const [index, session] of week.sessions.entries()) {
    if (!isRecord(session)) {
      errors.push(`${prefix} session ${index + 1} is not an object`);
      continue;
    }
    checkWeekSession(session, errors, `${prefix} session ${index + 1}:`);
  }
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
  if (
    "coachQuestion" in root &&
    root.coachQuestion !== null &&
    typeof root.coachQuestion !== "string"
  ) {
    errors.push("coachQuestion must be a string or null");
  }
  if (
    "modelsRemarks" in root &&
    root.modelsRemarks !== null &&
    typeof root.modelsRemarks !== "string"
  ) {
    errors.push("modelsRemarks must be a string or null");
  }
}

/** Checks the season's structured goal ledger. */
function checkSeasonGoals(
  season: Record<string, unknown>,
  errors: string[],
): void {
  if (!Array.isArray(season.goals)) {
    errors.push("season: goals must be an array");
    return;
  }
  for (const [index, goal] of season.goals.entries()) {
    if (!isRecord(goal)) {
      errors.push(`season: goal ${index + 1} is not an object`);
      continue;
    }
    for (const key of ["title", "date", "target"]) {
      checkField(goal, key, "string", errors, `season: goal ${index + 1}:`);
    }
    checkEnum(
      goal,
      "priority",
      GOAL_PRIORITIES,
      errors,
      `season: goal ${index + 1}:`,
    );
  }
}

/** Checks a block's structured sub-goals. */
function checkBlockSubGoals(
  block: Record<string, unknown>,
  prefix: string,
  errors: string[],
): void {
  if (!Array.isArray(block.subGoals)) {
    errors.push(`${prefix} subGoals must be an array`);
    return;
  }
  for (const [index, subGoal] of block.subGoals.entries()) {
    if (!isRecord(subGoal)) {
      errors.push(`${prefix} sub-goal ${index + 1} is not an object`);
      continue;
    }
    for (const key of ["goalTitle", "goalDate", "target", "byDate"]) {
      checkField(
        subGoal,
        key,
        "string",
        errors,
        `${prefix} sub-goal ${index + 1}:`,
      );
    }
    checkEnum(
      subGoal,
      "role",
      SUB_GOAL_ROLES,
      errors,
      `${prefix} sub-goal ${index + 1}:`,
    );
  }
}

/** Checks that the season revision has the requested shape before judging. */
function validateReviseSeasonPlan(plan: unknown): string[] {
  if (!isRecord(plan)) return ["response is not an object"];
  const errors: string[] = [];
  checkTopLevelKeys(
    plan,
    REVISE_SEASON_TOP_LEVEL_KEYS,
    ["coachQuestion", "modelsRemarks"],
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
        checkBlockSubGoals(block, `season: block ${index + 1}:`, errors);
      }
    }
    checkSeasonGoals(season, errors);
  }

  const block = plan.block;
  if (!isRecord(block)) {
    errors.push("missing block object");
  } else {
    for (const key of ["name", "focus", "rationale", "startDate", "endDate"]) {
      checkField(block, key, "string", errors, "block:");
    }
    checkBlockSubGoals(block, "block:", errors);
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
  if (!isRecord(week)) {
    errors.push("missing week object");
  } else {
    checkWeekPlan(week, REVISE_WEEK_START, errors, "week:");
  }

  const today = plan.today;
  if (!isRecord(today)) {
    errors.push("missing today object");
  } else {
    checkDaySession(today, errors, "today:");
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
 * Checks the goal-steering response: the revised season and block, the current
 * week ending on the prompt day, today, tomorrow and the new week. The model
 * has to keep today's completed session and put tomorrow in the new week.
 */
function validateGoalSteeringPlan(plan: unknown): string[] {
  if (!isRecord(plan)) return ["response is not an object"];
  const errors: string[] = [];
  checkTopLevelKeys(
    plan,
    GOAL_STEERING_TOP_LEVEL_KEYS,
    ["coachQuestion", "modelsRemarks"],
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
      for (const [index, entry] of season.blocks.entries()) {
        if (isRecord(entry)) {
          checkBlockSubGoals(entry, `season: block ${index + 1}:`, errors);
        }
      }
    }
    checkSeasonGoals(season, errors);
  }

  const block = plan.block;
  if (!isRecord(block)) {
    errors.push("missing block object");
  } else {
    for (const key of ["name", "focus", "rationale", "startDate", "endDate"]) {
      checkField(block, key, "string", errors, "block:");
    }
    checkBlockSubGoals(block, "block:", errors);
    if (block.startDate !== "2027-06-21") {
      errors.push("block: startDate must stay 2027-06-21");
    }
    if (!Array.isArray(block.weeks) || block.weeks.length === 0) {
      errors.push("block: weeks must be a non-empty array");
    }
  }

  const week = plan.week;
  if (!isRecord(week)) {
    errors.push("missing week object");
  } else {
    checkWeekPlan(week, GOAL_STEERING_WEEK_START, errors, "week:");
  }

  const today = plan.today;
  if (!isRecord(today)) {
    errors.push("missing today object");
  } else {
    checkDaySession(today, errors, "today:");
    if (today.date !== GOAL_STEERING_TODAY) {
      errors.push(`today date must be ${GOAL_STEERING_TODAY}`);
    }
    const sessions: unknown[] =
      isRecord(week) && Array.isArray(week.sessions)
        ? (week.sessions as unknown[])
        : [];
    const matching = sessions.find(
      (session) => isRecord(session) && session.date === GOAL_STEERING_TODAY,
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

  const tomorrow = plan.tomorrow;
  if (!isRecord(tomorrow)) {
    errors.push("tomorrow must be an object");
  } else {
    checkDaySession(tomorrow, errors, "tomorrow:");
    if (tomorrow.date !== GOAL_STEERING_NEXT_WEEK_START) {
      errors.push(`tomorrow date must be ${GOAL_STEERING_NEXT_WEEK_START}`);
    }
  }

  const nextWeek = plan.nextWeek;
  if (!isRecord(nextWeek)) {
    errors.push("nextWeek must be an object");
  } else {
    checkWeekPlan(nextWeek, GOAL_STEERING_NEXT_WEEK_START, errors, "nextWeek:");
    if (isRecord(tomorrow) && Array.isArray(nextWeek.sessions)) {
      const tomorrowInNextWeek = nextWeek.sessions.some(
        (session) =>
          isRecord(session) && session.date === GOAL_STEERING_NEXT_WEEK_START,
      );
      if (!tomorrowInNextWeek) {
        errors.push("tomorrow must be one of nextWeek's sessions");
      }
    }
  }

  if (!isRecord(plan.diet)) {
    errors.push("diet must be an object");
  }
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
  const atlasQuestionAsked =
    typeof root.coachQuestion === "string" &&
    root.coachQuestion.toLowerCase().includes("atlas");
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
  if (!blockOneChanged && !atlasQuestionAsked) {
    failures.push("block 1 is unchanged");
  }
  if (!blockOneStartDateKept) {
    failures.push(`block 1 does not start on ${baseline.startDate}`);
  }
  return {
    atlasMentioned,
    blockOneChanged,
    blockOneStartDateKept,
    atlasQuestionAsked,
    failures,
  };
}

/**
 * Reads the JSON object out of a model response. Direct JSON, a fenced block
 * and JSON surrounded by prose all appear in real runs, so all three are tried.
 */
export function extractJson(text: string): unknown {
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

/** Validates one prompt response against the contract that prompt requires. */
export function validatePromptPlan(
  prompt: BenchmarkPromptId,
  plan: unknown,
): string[] {
  switch (prompt) {
    case "reviseSeason":
      return validateReviseSeasonPlan(plan);
    case "goalSteering":
      return validateGoalSteeringPlan(plan);
  }
}

/**
 * Total time of the prompts that define the speed grade. The goal-steering
 * prompt adds ability coverage, not a reason to make an otherwise fast model
 * look slow, so it is excluded here.
 */
export function gradedPromptTimeMs(result: PromptModelResult): number | null {
  let total = 0;
  for (const id of GRADED_PROMPT_IDS) {
    const value = result.prompts[id]?.totalTimeMs;
    if (value === undefined) return null;
    total += value;
  }
  return total;
}

/** Total cost of the prompts that define the cost grade. */
export function gradedPromptCostUsd(result: PromptModelResult): number | null {
  let total = 0;
  for (const id of GRADED_PROMPT_IDS) {
    const value = result.prompts[id]?.totalCostUsd;
    if (value === undefined) return null;
    total += value;
  }
  return total;
}

/** True for a contract error that only describes an extra or unexpected key. */
export function isWarningOnlyPromptError(error: string): boolean {
  return WARNING_LEVEL_ERROR_PREFIXES.some((prefix) =>
    error.startsWith(prefix),
  );
}

/** The contract errors that must invalidate a response, ignoring warnings. */
export function fatalPromptErrors(
  prompt: BenchmarkPromptId,
  plan: unknown,
): string[] {
  return validatePromptPlan(prompt, plan).filter(
    (error) => !isWarningOnlyPromptError(error),
  );
}

function asJudgeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Reads a judge response, clamping each component to its rubric maximum and
 * recomputing the total from the components so a lying `score` cannot win.
 */
export function parseJudge(value: unknown): {
  components: Record<string, number>;
  score: number;
  note: string;
} | null {
  if (!isRecord(value)) return null;
  const contract = asJudgeNumber(value.contract);
  const fidelity = asJudgeNumber(value.fidelity);
  const design = asJudgeNumber(value.design);
  const rationale = asJudgeNumber(value.rationale);
  const grounding = asJudgeNumber(value.grounding);
  const detail = asJudgeNumber(value.detail);
  const note = typeof value.judgment === "string" ? value.judgment.trim() : "";
  if (
    contract === null ||
    fidelity === null ||
    design === null ||
    rationale === null ||
    grounding === null ||
    detail === null ||
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

/**
 * Combines every judged prompt into the model's benchmark result. The score is
 * the mean of the prompt scores; a component counts at its weaker value so a
 * failing component in any prompt still grades the model down.
 */
/**
 * Averages repeated judge passes for one prompt. A single Haiku pass moves by
 * more than a point between runs, which is wider than the difference between
 * capable models, so a comparison can ask for several passes and score the mean.
 * The note comes from the pass closest to the mean score so the report still
 * shows one specific judgment rather than a synthetic summary.
 */
export function averagePromptJudges(
  passes: readonly PromptJudge[],
): PromptJudge {
  if (passes.length === 0) {
    throw new Error("cannot average zero judge passes");
  }
  const scored = passes.filter((pass) => pass.judge.error === null);
  const reference = passes[0];
  if (reference === undefined) {
    throw new Error("cannot average zero judge passes");
  }
  if (scored.length === 0) {
    return {
      ...reference,
      judge: {
        ...reference.judge,
        attempts: passes.reduce((sum, pass) => sum + pass.judge.attempts, 0),
        timeMs: passes.reduce((sum, pass) => sum + pass.judge.timeMs, 0),
        costUsd: passes.reduce((sum, pass) => sum + pass.judge.costUsd, 0),
      },
    };
  }
  const components: Record<string, number> = {};
  for (const key of BENCHMARK_COMPONENT_KEYS) {
    const values = scored.map((pass) => pass.components[key] ?? 0);
    components[key] =
      Math.round(
        (values.reduce((sum, value) => sum + value, 0) / values.length) * 10,
      ) / 10;
  }
  const score =
    Math.round(
      BENCHMARK_COMPONENT_KEYS.reduce(
        (sum, key) => sum + (components[key] ?? 0),
        0,
      ) * 10,
    ) / 10;
  const notePass = scored.reduce((closest, pass) =>
    Math.abs(pass.score - score) < Math.abs(closest.score - score)
      ? pass
      : closest,
  );
  return {
    score,
    components,
    note: `${notePass.note} Mean of ${scored.length} judge pass${scored.length === 1 ? "" : "es"}.`,
    judge: {
      model: reference.judge.model,
      attempts: passes.reduce((sum, pass) => sum + pass.judge.attempts, 0),
      timeMs: passes.reduce((sum, pass) => sum + pass.judge.timeMs, 0),
      costUsd: passes.reduce((sum, pass) => sum + pass.judge.costUsd, 0),
      error: null,
    },
  };
}

export function combinePromptScores(
  scores: Readonly<Record<BenchmarkPromptId, PromptScoreInput>>,
  gateFailures: readonly string[],
): CombinedPromptScore {
  const entries = BENCHMARK_PROMPTS.map((definition) => ({
    definition,
    score: scores[definition.id],
  }));
  const components: Record<string, number> = {};
  for (const key of BENCHMARK_COMPONENT_KEYS) {
    components[key] = Math.min(
      ...entries.map((entry) => entry.score.components[key] ?? 0),
    );
  }
  const notes = entries.map(
    (entry) => `${entry.definition.label}: ${entry.score.note}`,
  );
  if (gateFailures.length > 0) {
    notes.push(`Hard gates failed: ${gateFailures.join("; ")}.`);
  }
  return {
    score:
      Math.round(
        (entries.reduce((sum, entry) => sum + entry.score.score, 0) /
          Math.max(entries.length, 1)) *
          10,
      ) / 10,
    components,
    failed: gateFailures.length > 0,
    note: notes.join(" "),
  };
}
