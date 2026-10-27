import type { SeasonPlan } from "@killingit/shared";
import {
  ACTIVITY_COMMENT_RULE,
  formatPlanContext,
  formatSeasonPlan,
  type ActivityCommentContext,
  type AthleteAnswerContext,
  type ManualActivityContext,
  type PlanContextInput,
  type RecentActivityContext,
} from "./planContext.js";
import {
  BLOCK_CONTRACT,
  JSON_RULES,
  SEASON_CONTRACT,
  TRAINING_LOAD_RULES,
} from "./planUpdatePrompt.js";

export interface SeasonPlanInput extends PlanContextInput {
  athleteAnswers: readonly AthleteAnswerContext[];
  recentActivities: readonly RecentActivityContext[];
  today: string;
  timezone?: string;
  manualActivities?: readonly ManualActivityContext[];
  activityComments?: readonly ActivityCommentContext[];
  weeklyNote?: string | null;
}

export interface InitialBlockInput extends SeasonPlanInput {
  season: SeasonPlan;
}

export const SEASON_PLAN_SYSTEM_PROMPT = `You are an expert endurance coach. Create a season plan for an amateur athlete. Use state of the art training science to make the best possible plan for the athlete.

You receive the athlete's profile and recent training, including each activity's coach review and the coach's reply to the athlete's comment. You also receive manually recorded activities, comments on activities, a general weekly note, and coach summaries of completed weeks and blocks with the athlete's feedback on them. ${ACTIVITY_COMMENT_RULE} Use all of these to understand their goal, available time, experience, preferences, constraints, and subjective feedback. Use the recent activities to judge their current fitness, fatigue, and consistency.

The season starts on today's date and ends at the athlete's main goal or the end of the available training period. Divide the season into ordered, contiguous blocks (for example base, build, specialization, taper, or whatever best fits the athlete). Each block needs a name, focus, start and end dates, and a week count. The blocks must cover the season without gaps and the first block must start on today's date. Include a concise rationale explaining the season's shape and the training-science reasoning behind the block order.

${JSON_RULES}
{
  "season": ${SEASON_CONTRACT}
}`;

export const INITIAL_BLOCK_SYSTEM_PROMPT = `You are an expert endurance coach. Create the first block of the season plan for an amateur athlete. Use state of the art training science to make the best possible plan for the athlete.

You receive the athlete's profile, recent training with coach reviews and replies, manually recorded activities, comments on activities, a general weekly note, coach summaries of completed weeks and blocks, and the season plan. ${ACTIVITY_COMMENT_RULE} The first block summary in the season defines the block's name, focus, dates, and week count. Expand it into a detailed block plan with its weeks and target loads. The block must start on today's date, and its weeks must add up to the planned week count. Keep the season unchanged. Include a concise rationale explaining the block's purpose and progression.

${TRAINING_LOAD_RULES}

${JSON_RULES}
{
  "block": ${BLOCK_CONTRACT}
}`;

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
    'Create the season plan. Return one JSON object whose top-level key is exactly "season".',
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
    'Create the first block. Return one JSON object whose top-level key is exactly "block".',
  ].join("\n");
}
