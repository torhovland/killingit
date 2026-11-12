import {
  buildDailyUpdateMessages,
  buildPlanUpdateMessages,
} from "../../../apps/api/src/llm/planUpdatePrompt.js";
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

export type BenchmarkPromptId = "today" | "reviseSeason";

export interface BenchmarkPromptDefinition {
  id: BenchmarkPromptId;
  label: string;
  maxTokens: number;
  retryMaxTokens: number;
}

/**
 * The two prompts every catalog model answers. Both are built by the app's own
 * prompt builders from the fixture athlete, so a rule, contract or context
 * change reaches the benchmark instead of leaving it on a frozen snapshot.
 */
export const BENCHMARK_PROMPTS: readonly BenchmarkPromptDefinition[] = [
  {
    id: "today",
    label: "Today plan",
    maxTokens: 8_192,
    retryMaxTokens: 8_192,
  },
  {
    id: "reviseSeason",
    label: "Season revision",
    maxTokens: 16_384,
    retryMaxTokens: 32_768,
  },
];

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
