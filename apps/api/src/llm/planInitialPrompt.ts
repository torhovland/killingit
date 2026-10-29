import type { SeasonPlan } from "@killingit/shared";
import {
  formatPlanContext,
  formatSeasonPlan,
  type PlanContextInput,
} from "./planContext.js";
import {
  BLOCK_CONTRACT,
  BODY_METRIC_POINT_CONTRACT,
  BODY_METRIC_RULES,
  COACH_PERSONA,
  JSON_RULES,
  jsonTopLevelKeys,
  PLAN_INPUT_GUIDANCE,
  promptSections,
  RATIONALE_RULES,
  SEASON_CONTRACT,
  TRAINING_LOAD_RULES,
  TRAINING_SCIENCE_RULE,
} from "./promptRules.js";

export type SeasonPlanInput = PlanContextInput;

export interface InitialBlockInput extends SeasonPlanInput {
  season: SeasonPlan;
}

export const SEASON_PLAN_SYSTEM_PROMPT = promptSections(
  COACH_PERSONA,
  "Create a season plan for an amateur athlete.",
  TRAINING_SCIENCE_RULE,
  PLAN_INPUT_GUIDANCE,
  "Use the recent activities to judge the athlete's current fitness, fatigue, and consistency.",
  "The season starts on today's date and ends at the athlete's main goal or the end of the available training period. Divide the season into ordered, contiguous blocks (for example base, build, specialization, taper, or whatever best fits the athlete). Each block needs a name, focus, start and end dates, and a week count. The blocks must cover the season without gaps and the first block must start on today's date. Include a concise rationale explaining the season's shape and the training-science reasoning behind the block order.",
  RATIONALE_RULES,
  BODY_METRIC_RULES,
  JSON_RULES,
  `{
  "season": ${SEASON_CONTRACT},
  "bodyMetrics": [${BODY_METRIC_POINT_CONTRACT}]
}`,
);

export const INITIAL_BLOCK_SYSTEM_PROMPT = promptSections(
  COACH_PERSONA,
  "Create the first block of the season plan for an amateur athlete.",
  TRAINING_SCIENCE_RULE,
  PLAN_INPUT_GUIDANCE,
  "The first block summary in the season defines the block's name, focus, dates, and week count. Expand it into a detailed block plan with its weeks and target loads. The block must start on today's date, and its weeks must add up to the planned week count. Keep the season unchanged. Include a concise rationale explaining the block's purpose and progression.",
  RATIONALE_RULES,
  TRAINING_LOAD_RULES,
  BODY_METRIC_RULES,
  JSON_RULES,
  `{
  "block": ${BLOCK_CONTRACT},
  "bodyMetrics": [${BODY_METRIC_POINT_CONTRACT}]
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
