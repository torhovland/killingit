import type { SeasonPlan } from "@killingit/shared";
import {
  formatPlanContext,
  formatSeasonPlan,
  type PlanContextInput,
} from "./planContext.js";
import {
  BLOCK_CONTRACT,
  BODY_METRIC_POINT_CONTRACT,
  COACH_RESPONSE_NOTES_CONTRACT,
  JSON_RULES,
  jsonTopLevelKeys,
  GLOBAL_PROMPT_RULES,
  PLAN_PROMPT_RULES,
  promptSections,
  SEASON_CONTRACT,
  TRAINING_LOAD_RULES,
} from "./promptRules.js";

export type SeasonPlanInput = PlanContextInput;

export interface InitialBlockInput extends SeasonPlanInput {
  season: SeasonPlan;
}

export const SEASON_PLAN_SYSTEM_PROMPT = promptSections(
  GLOBAL_PROMPT_RULES,
  PLAN_PROMPT_RULES,
  "Create a season plan for an amateur athlete.",
  "Use the recent activities to judge the athlete's current fitness, fatigue, and consistency.",
  "The season starts on today's date and ends when the athlete's goals and any additional recovery have passed. Divide the season into ordered, contiguous blocks (for example base, build, specialization, taper, or whatever best fits the athlete). Each block needs a name, focus, start and end dates, and a week count. The blocks must cover the season without gaps and the first block must start on today's date. Include a concise rationale explaining the season's shape and the training-science reasoning behind the block order.",
  JSON_RULES,
  `{
  "season": ${SEASON_CONTRACT},
  "bodyMetrics": [${BODY_METRIC_POINT_CONTRACT}],
  ${COACH_RESPONSE_NOTES_CONTRACT}
}`,
);

export const INITIAL_BLOCK_SYSTEM_PROMPT = promptSections(
  GLOBAL_PROMPT_RULES,
  PLAN_PROMPT_RULES,
  "Create the first block of the season plan for an amateur athlete.",
  "The first block summary in the season defines the block's name, focus, dates, and week count. Expand it into a detailed block plan with its weeks and target loads. The block must start on today's date, and its weeks must add up to the planned week count. Keep the season unchanged. Include a concise rationale explaining the block's purpose and progression.",
  TRAINING_LOAD_RULES,
  JSON_RULES,
  `{
  "block": ${BLOCK_CONTRACT},
  "bodyMetrics": [${BODY_METRIC_POINT_CONTRACT}],
  ${COACH_RESPONSE_NOTES_CONTRACT}
}`,
);

export function buildSeasonPlanMessages(input: SeasonPlanInput): {
  role: "system" | "user";
  content: string;
}[] {
  return [
    { role: "system", content: SEASON_PLAN_SYSTEM_PROMPT },
    { role: "user", content: buildSeasonPlanPrompt(input) },
  ];
}

export function buildSeasonPlanPrompt(input: SeasonPlanInput): string {
  return [
    ...formatPlanContext(input),
    "",
    "Create the season plan.",
    jsonTopLevelKeys(["season", "bodyMetrics"]),
  ].join("\n");
}

export function buildInitialBlockMessages(input: InitialBlockInput): {
  role: "system" | "user";
  content: string;
}[] {
  return [
    { role: "system", content: INITIAL_BLOCK_SYSTEM_PROMPT },
    { role: "user", content: buildInitialBlockPrompt(input) },
  ];
}

export function buildInitialBlockPrompt(input: InitialBlockInput): string {
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
