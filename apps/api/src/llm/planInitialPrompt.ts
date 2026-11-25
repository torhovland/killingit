import type { SeasonPlan } from "@killingit/shared";
import { formatPlanContext, type PlanContextInput } from "./planContext.js";
import { formatSeasonPlan } from "./planLevelsContext.js";
import {
  BLOCK_CONTRACT,
  BODY_METRIC_POINT_CONTRACT,
  COACH_RESPONSE_NOTES_CONTRACT,
  JSON_RULES,
  jsonTopLevelKeys,
  GLOBAL_PROMPT_RULES,
  type LlmMessage,
  PLAN_PROMPT_RULES,
  promptSections,
  SEASON_BLOCK_RULES,
  SEASON_CONTRACT,
  SEASON_INTRODUCTION_RULES,
  systemUserMessages,
  TRAINING_LOAD_RULES,
} from "./promptRules.js";

export type SeasonPlanInput = PlanContextInput;

export interface InitialBlockInput extends SeasonPlanInput {
  season: SeasonPlan;
}

const SEASON_PLAN_SYSTEM_PROMPT = promptSections(
  GLOBAL_PROMPT_RULES,
  PLAN_PROMPT_RULES,
  "Create a season plan for an amateur athlete.",
  "Use the recent activities to judge the athlete's current fitness, fatigue, and consistency.",
  "The season starts on today's date and ends when the athlete's goals and any additional recovery have passed. Divide the season into ordered blocks (for example base, build, specialization, taper, or whatever best fits the athlete). Each block needs a name, focus, start and end dates, a week count, and its structured sub-goals. Include a concise rationale explaining the season's shape and the training-science reasoning behind the block order.",
  'Fill "season.goals" with every dated goal in date order, and give every block its "subGoals" for the goals still ahead. A goal that comes later in the season is not ignored: say what an earlier block builds or maintains for it.',
  SEASON_INTRODUCTION_RULES,
  SEASON_BLOCK_RULES,
  JSON_RULES,
  `{
  "season": ${SEASON_CONTRACT},
  "bodyMetrics": [${BODY_METRIC_POINT_CONTRACT}],
  ${COACH_RESPONSE_NOTES_CONTRACT}
}`,
);

const INITIAL_BLOCK_SYSTEM_PROMPT = promptSections(
  GLOBAL_PROMPT_RULES,
  PLAN_PROMPT_RULES,
  "Create the first block of the season plan for an amateur athlete.",
  "The first block summary in the season defines the block's name, focus, dates, week count and sub-goals. Expand it into a detailed block plan with its weeks and target loads. Copy the summary's \"subGoals\" into the detailed block exactly, and build the weeks and target loads toward them. The block must start on today's date, and its weeks must add up to the planned week count. Keep the season unchanged. Include a concise rationale explaining the block's purpose and progression.",
  TRAINING_LOAD_RULES,
  JSON_RULES,
  `{
  "block": ${BLOCK_CONTRACT},
  "bodyMetrics": [${BODY_METRIC_POINT_CONTRACT}],
  ${COACH_RESPONSE_NOTES_CONTRACT}
}`,
);

export function buildSeasonPlanMessages(input: SeasonPlanInput): LlmMessage[] {
  return systemUserMessages(
    SEASON_PLAN_SYSTEM_PROMPT,
    buildSeasonPlanPrompt(input),
  );
}

function buildSeasonPlanPrompt(input: SeasonPlanInput): string {
  return [
    ...formatPlanContext(input),
    "",
    "Create the season plan.",
    jsonTopLevelKeys(["season", "bodyMetrics"]),
  ].join("\n");
}

export function buildInitialBlockMessages(
  input: InitialBlockInput,
): LlmMessage[] {
  return systemUserMessages(
    INITIAL_BLOCK_SYSTEM_PROMPT,
    buildInitialBlockPrompt(input),
  );
}

function buildInitialBlockPrompt(input: InitialBlockInput): string {
  return [
    ...formatPlanContext(input),
    "",
    "Current season plan:",
    formatSeasonPlan(input.season),
    "",
    "Create the first block.",
    jsonTopLevelKeys(["block", "bodyMetrics"]),
  ].join("\n");
}
