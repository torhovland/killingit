import type { BlockPlan, SeasonPlan, WeekPlan } from "@killingit/shared";
import {
  ACTIVITY_COMMENT_RULE,
  formatBlockPlan,
  formatPlanContext,
  formatSeasonPlan,
  formatWeekPlan,
  type ActivityCommentContext,
  type AthleteAnswerContext,
  type ManualActivityContext,
  type PlanContextInput,
  type RecentActivityContext,
} from "./planContext.js";

interface BasePlanUpdateInput extends PlanContextInput {
  athleteAnswers: readonly AthleteAnswerContext[];
  recentActivities: readonly RecentActivityContext[];
  today: string;
  timezone?: string;
  manualActivities?: readonly ManualActivityContext[];
  activityComments?: readonly ActivityCommentContext[];
  weeklyNote?: string | null;
}

/** Input for the daily cascade: today plus the current week. */
export interface DailyUpdateInput extends BasePlanUpdateInput {
  season: SeasonPlan;
  block: BlockPlan;
  week: WeekPlan;
}

/** Input for the weekly cascade: the new week plus the current block. */
export interface WeeklyUpdateInput extends BasePlanUpdateInput {
  season: SeasonPlan;
  block: BlockPlan;
  /** Monday of the week being planned (YYYY-MM-DD). */
  weekStartDate: string;
}

/** Input for the block cascade: the next block plus the season. */
export interface BlockUpdateInput extends BasePlanUpdateInput {
  season: SeasonPlan;
  block: BlockPlan;
  /** The day after the completed block ends (YYYY-MM-DD). */
  nextBlockStartDate: string;
}

const DAY_CONTRACT = `{
  "date": "YYYY-MM-DD",
  "type": "workout | rest",
  "title": "string",
  "description": "string",
  "durationMinutes": 0,
  "intensity": "easy | moderate | hard | rest",
  "alternatives": ["string"],
  "rationale": "string",
  "optional": false,
  "optionalRationale": "string"
}`;

const WEEK_CONTRACT = `{
  "startDate": "YYYY-MM-DD",
  "focus": "string",
  "rationale": "string",
  "sessions": [
    {
      "date": "YYYY-MM-DD",
      "day": "Monday",
      "type": "workout | rest",
      "title": "string",
      "description": "string",
      "durationMinutes": 0,
      "intensity": "easy | moderate | hard | rest",
      "status": "completed | planned | missed | rest"
    }
  ]
}`;

export const BLOCK_CONTRACT = `{
  "name": "string",
  "focus": "string",
  "rationale": "string",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "weeks": [
    {
      "number": 1,
      "startDate": "YYYY-MM-DD",
      "focus": "string",
      "targetLoad": "string"
    }
  ]
}`;

export const SEASON_CONTRACT = `{
  "goal": "string",
  "rationale": "string",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "blocks": [
    {
      "name": "string",
      "focus": "string",
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "weekCount": 0
    }
  ]
}`;

export const ENUM_RULES = `For every type field use either "workout" or "rest"; for every intensity field use "easy", "moderate", "hard", or "rest".`;
export const JSON_RULES = `Return only a single valid JSON object with exactly this shape. Do not add markdown fences, headings, explanations, or extra fields. When a contract lists choices separated by "|", output exactly one of those choices and never the list itself. Replace every placeholder such as "YYYY-MM-DD", "string", or 0 with a real value.`;

export const DAILY_UPDATE_SYSTEM_PROMPT = `You are an expert endurance coach. Update today's session, the rest of the current week, and tomorrow's session for an amateur athlete. Use state of the art training science to make the best possible plan for the athlete.

You receive the athlete's profile, recent activities with coach analyses, the current season, the current block, and the current week. You also receive manually recorded activities, comments on activities, and a general weekly note. Use all of these to see what the athlete actually completed or missed, how they responded, whether today should be a workout or a rest day, and what constraints or feedback they have for the week. ${ACTIVITY_COMMENT_RULE} Respect the athlete's available time and constraints. The weekly note is a hard constraint: if it says the athlete cannot train on a specific day, move or cancel the session on that day. If a manually recorded activity indicates significant fatigue or extra load, adjust the upcoming sessions accordingly.

Keep the week's start date and exactly seven sessions. For days before today, do not propose new workouts: describe what the athlete actually did using the recent activities and set each status to "completed", "missed", or "rest". The today object must match today's date and must be present as the matching session in week.sessions. Revise the remaining sessions so the week stays coherent with the block's focus and the athlete's current fatigue. Include a rationale for today's session and for the week's overall structure.

Also provide a suggested workout or rest for tomorrow, consistent with the revised week and the block's focus. For both today and tomorrow, set "optional" to true when the session can be skipped without undermining the plan (for example, an easy recovery session), and false when skipping would hurt the athlete's progression. In "optionalRationale", explain concisely why the session should not be skipped or why it is safe to consider it optional.

${ENUM_RULES}

${JSON_RULES}
{
  "today": ${DAY_CONTRACT},
  "tomorrow": ${DAY_CONTRACT},
  "week": ${WEEK_CONTRACT}
}`;

export const WEEKLY_UPDATE_SYSTEM_PROMPT = `You are an expert endurance coach. Create the week starting on the supplied week start date and revise the current block plan for an amateur athlete. Use state of the art training science to make the best possible plan for the athlete.

You receive the athlete's profile, recent activities with coach analyses, the current season, and the current block. You also receive manually recorded activities, comments on activities, and a general weekly note. Use all of these to judge what the athlete completed, how they responded, how the block's progression should be adjusted, and what constraints or feedback they have for the week. ${ACTIVITY_COMMENT_RULE} The weekly note is a hard constraint: if it says the athlete cannot train on a specific day, move or cancel the session on that day. If a manually recorded activity indicates significant fatigue or extra load, adjust the week's sessions accordingly. The new week must fit the block's focus and progression, must start on the supplied week start date, and must contain exactly seven sessions. For days before today, do not propose new workouts: describe what actually happened and set each status to "completed", "missed", or "rest". Include a rationale for the week and for the revised block.

Revise the block's weeks and target loads where the athlete's progress or recent training requires it. Keep the block's name, focus, and dates unless a change is clearly justified. Do not change the season plan.

${ENUM_RULES}

${JSON_RULES}
{
  "week": ${WEEK_CONTRACT},
  "block": ${BLOCK_CONTRACT}
}`;

export const BLOCK_UPDATE_SYSTEM_PROMPT = `You are an expert endurance coach. Create the next block and revise the season plan for an amateur athlete. Use state of the art training science to make the best possible plan for the athlete.

The current block has ended. You receive the athlete's profile, recent activities with coach analyses, the current season, and the completed block. Create the next block starting on the supplied next block start date, consistent with the season goal and any remaining blocks in the season. Revise the season plan to include the new block and adjust upcoming blocks where the athlete's progress requires it. Keep the season goal and completed blocks intact. Include a rationale for the new block and for the revised season.

${ENUM_RULES}

${JSON_RULES}
{
  "block": ${BLOCK_CONTRACT},
  "season": ${SEASON_CONTRACT}
}`;

export function buildDailyUpdateMessages(input: DailyUpdateInput): {
  role: "system" | "user";
  content: string;
}[] {
  return [
    { role: "system", content: DAILY_UPDATE_SYSTEM_PROMPT },
    { role: "user", content: buildDailyUpdatePrompt(input) },
  ];
}

export function buildDailyUpdatePrompt(input: DailyUpdateInput): string {
  return [
    ...formatPlanContext(input),
    "",
    "Current season plan:",
    formatSeasonPlan(input.season),
    "",
    "Current block plan:",
    formatBlockPlan(input.block),
    "",
    "Current week plan:",
    formatWeekPlan(input.week),
    "",
    "Create today's session and revise this week's remaining sessions. Return only the JSON object described in the system prompt.",
  ].join("\n");
}

export function buildWeeklyUpdateMessages(input: WeeklyUpdateInput): {
  role: "system" | "user";
  content: string;
}[] {
  return [
    { role: "system", content: WEEKLY_UPDATE_SYSTEM_PROMPT },
    { role: "user", content: buildWeeklyUpdatePrompt(input) },
  ];
}

export function buildWeeklyUpdatePrompt(input: WeeklyUpdateInput): string {
  return [
    ...formatPlanContext(input),
    `Week start date: ${input.weekStartDate}`,
    "",
    "Current season plan:",
    formatSeasonPlan(input.season),
    "",
    "Current block plan:",
    formatBlockPlan(input.block),
    "",
    "Create the new week and revise the block plan. Return only the JSON object described in the system prompt.",
  ].join("\n");
}

export function buildBlockUpdateMessages(input: BlockUpdateInput): {
  role: "system" | "user";
  content: string;
}[] {
  return [
    { role: "system", content: BLOCK_UPDATE_SYSTEM_PROMPT },
    { role: "user", content: buildBlockUpdatePrompt(input) },
  ];
}

export function buildBlockUpdatePrompt(input: BlockUpdateInput): string {
  return [
    ...formatPlanContext(input),
    `Next block start date: ${input.nextBlockStartDate}`,
    "",
    "Current season plan:",
    formatSeasonPlan(input.season),
    "",
    "Completed block plan:",
    formatBlockPlan(input.block),
    "",
    "Create the next block and revise the season plan. Return only the JSON object described in the system prompt.",
  ].join("\n");
}
