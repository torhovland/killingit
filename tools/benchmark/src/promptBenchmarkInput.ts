import { z } from "zod";
import { PLAN_MAX_TOKENS } from "../../../apps/api/src/llm/planBudget.js";
import {
  buildDailyUpdateMessages,
  buildPlanUpdateMessages,
} from "../../../apps/api/src/llm/planUpdatePrompt.js";
import {
  attemptLadder,
  type CompletionAttempt,
} from "../../../apps/api/src/llm/resilientCompletion.js";
import {
  BENCHMARK_COACHING_SURVEY_ADJUSTMENTS,
  benchmarkBlockPlan,
  benchmarkDayPlan,
  benchmarkPlanContext,
  benchmarkSeasonPlan,
  benchmarkWeekPlan,
} from "./promptBenchmarkFixture.js";

/** The day the daily-update benchmark plans for; a Friday in week 2. */
export const TODAY_BENCHMARK_DATE = "2026-10-30";

/** The day the season revision is requested on; the Sunday of the same week. */
export const REVISE_SEASON_DATE = "2026-11-01";

/** The Monday of the week both benchmark dates fall inside. */
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
  "diet",
  "bodyMetrics",
] as const;

/** The ids of the two prompts, as stored in `results.json` and `raw/*.json`. */
export const benchmarkPromptIdSchema = z.enum(["today", "reviseSeason"]);

export type BenchmarkPromptId = z.infer<typeof benchmarkPromptIdSchema>;

export interface BenchmarkPromptDefinition {
  id: BenchmarkPromptId;
  label: string;
  /** The plan output budget the app gives this prompt's plan level. */
  maxTokens: number;
}

/**
 * The two prompts every catalog model answers. Both are built by the app's own
 * prompt builders from the fixture athlete, so a rule, contract or context
 * change reaches the benchmark instead of leaving it on a frozen snapshot.
 *
 * The budget is the app's own plan budget: a benchmark run must give every
 * model the same room the app gives it, or reasoning tokens exhaust the ceiling
 * and a capable model is graded F for truncation instead of coaching quality.
 * The run stage walks the app's whole fallback ladder from that budget.
 */
export const BENCHMARK_PROMPTS: readonly BenchmarkPromptDefinition[] = [
  { id: "today", label: "Today plan", maxTokens: PLAN_MAX_TOKENS },
  {
    id: "reviseSeason",
    label: "Season revision",
    maxTokens: PLAN_MAX_TOKENS,
  },
];

/**
 * The app's fallback ladder for this prompt, with an optional manual budget
 * override for experiments. `MAX_TOKENS` and `MAX_TOKENS_REVISE` replace the
 * base budget; the reasoning fallbacks and the doubled budget still follow.
 */
export function benchmarkAttempts(
  definition: BenchmarkPromptDefinition,
): CompletionAttempt[] {
  const overrideKey =
    definition.id === "today" ? "MAX_TOKENS" : "MAX_TOKENS_REVISE";
  const override = Number(process.env[overrideKey]);
  const base =
    Number.isFinite(override) && override > 0 ? override : definition.maxTokens;
  return attemptLadder(base);
}

export interface BenchmarkPromptMessage {
  role: "system" | "user";
  content: string;
}

/** Renders the messages as the judge receives the original prompt. */
export function formatBenchmarkPrompt(
  messages: readonly BenchmarkPromptMessage[],
): string {
  return messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join("\n\n");
}

/**
 * The messages sent to a model for one benchmark prompt. The daily-update
 * prompt is the one the app sends when it builds a week's first day; the season
 * revision is the plan-update prompt the app sends when the athlete's goal
 * changes.
 */
export function buildBenchmarkPromptMessages(
  id: BenchmarkPromptId,
): BenchmarkPromptMessage[] {
  if (id === "today") {
    return buildDailyUpdateMessages({
      ...benchmarkPlanContext(TODAY_BENCHMARK_DATE),
      season: benchmarkSeasonPlan(),
      block: benchmarkBlockPlan(),
      week: benchmarkWeekPlan(TODAY_BENCHMARK_DATE),
    });
  }
  const season = benchmarkSeasonPlan();
  return buildPlanUpdateMessages({
    ...benchmarkPlanContext(REVISE_SEASON_DATE),
    season,
    block: benchmarkBlockPlan(),
    week: benchmarkWeekPlan(REVISE_SEASON_DATE),
    todayPlan: benchmarkDayPlan(REVISE_SEASON_DATE),
    tomorrow: null,
    nextWeek: null,
    nextBlock: null,
    revision: {
      season: true,
      block: false,
      week: true,
      day: true,
      tomorrow: false,
      nextWeek: false,
      nextBlock: false,
      progress: true,
    },
    blockStartDate: season.startDate,
    coachingSurveyAdjustments: BENCHMARK_COACHING_SURVEY_ADJUSTMENTS,
  });
}
