import type { BlockPlan, SeasonPlan, WeekPlan } from "@killingit/shared";
import { addDays, startOfWeek } from "../plans/dates.js";
import {
  ACTIVITY_COMMENT_RULE,
  formatBlockPlan,
  formatPlanContext,
  formatSeasonPlan,
  formatWeekPlan,
  SESSION_PURPOSE_RULES,
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
  "status": "completed | partial | planned | missed | rest",
  "alternatives": ["string"],
  "rationale": "string",
  "optional": false,
  "optionalRationale": "string",
  "outdoor": true
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
      "status": "completed | partial | planned | missed | rest",
      "outdoor": true
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

export const ENUM_RULES = `For every type field use either "workout" or "rest"; for every intensity field use "easy", "moderate", "hard", or "rest". For a rest session set both type and intensity to "rest"; for a workout set type to "workout" and intensity to "easy", "moderate", or "hard". These are exact, lowercase strings: never output a session name such as "run", "strength", or "rest day" as a type, and never copy the "|" choices from the contract into the response.`;
export const JSON_RULES = `Return only a single valid JSON object with exactly this shape. Do not add markdown fences, headings, explanations, or extra fields. Every field must use the exact name and value type shown in the contract. The top-level keys must be exactly the keys shown at the top level of the contract, with the same nesting; never return a bare inner object, an array, or a wrapper such as "plan" or "response". When a contract lists choices separated by "|", output exactly one of those choices as a string and never the list itself. Replace every placeholder such as "YYYY-MM-DD", "string", or 0 with a real value.`;

/**
 * Shared weather and daylight instruction for prompts that choose which day
 * gets which session. The athlete's survey answers define explicit limits;
 * without one, the coach should still place outdoor work sensibly and prefer
 * daylight.
 */
export const WEATHER_PLANNING_RULES = `When a daily forecast is provided, use it to choose which day gets each session. Set "outdoor" to false for sessions done indoors (gym, treadmill, trainer, pool) and true for sessions done outside (running, cycling, hiking, and similar). Weather only restricts outdoor sessions.

Respect every weather preference or limit the athlete states in their profile. For example, if they will not ride outdoors in rain or when the temperature is below 10 °C, do not schedule such a ride; move it to a suitable day, make it indoor, or replace it with an equivalent session. If the athlete has no weather preference, use common sense: put longer or more demanding outdoor sessions on the best-weather days and shorter or indoor sessions on the poorer days. For example, if Saturday is sunny and Sunday is rainy, schedule a long hike on Saturday and a short run on Sunday.

The daylight times let you keep outdoor work in daylight. Unless the athlete's profile, weekly notes, activity comments, or other input explicitly says they are willing or able to train in the dark, or prefer it, assume the athlete prefers daylight over darkness. Honour any such statement they do make and do not invent a darkness preference they did not state. If the athlete says they can train before or after work on weekdays, compare those training windows with sunrise and sunset. When the only daylight falls inside their working day, so a weekday outdoor session would happen in the dark, put long outdoor sessions at the weekend and keep weekday outdoor sessions within the available daylight or make them indoor.`;

export const DAILY_UPDATE_SYSTEM_PROMPT = `You are an expert endurance coach. Update today's session, the rest of the current week, and tomorrow's session for an amateur athlete. Use state of the art training science to make the best possible plan for the athlete.

You receive the athlete's profile, recent activities with coach analyses, program reviews, and coach replies, the current season, the current block, and the current week. You also receive manually recorded activities, comments on activities, a general weekly note, and coach summaries of completed weeks and blocks with the athlete's feedback on them. Use all of these to see what the athlete actually completed or missed, how they responded, whether today should be a workout or a rest day, and what constraints or feedback they have for the week. ${ACTIVITY_COMMENT_RULE} Respect the athlete's available time and constraints. The weekly note is a hard constraint: if it says the athlete cannot train on a specific day, move or cancel the session on that day. If a manually recorded activity indicates significant fatigue or extra load, adjust the upcoming sessions accordingly.

Keep the week's start date and exactly seven sessions. For days before today, do not propose new workouts: describe what the athlete actually did using the recent activities and set each status to "completed", "partial", "missed", or "rest". If an activity has already been recorded for today, today's plan must describe that completed activity, using the athlete's latest comment to correct the summary, instead of proposing another workout. The today object must match today's date and must be present as the matching session in week.sessions. Give today's plan and today's week session the same status: "completed" when the recorded activity substantially matched the planned session, or "partial" when only a meaningful part was done. Allow reasonable slack: a 60-minute ride recorded as 50 minutes is still completed, and power or pace zones that are close but not exact do not make a session partial. Revise the remaining sessions so the week stays coherent with the block's focus and the athlete's current fatigue. Include a rationale for today's session and for the week's overall structure.

${WEATHER_PLANNING_RULES}

Also provide a suggested workout or rest for tomorrow, consistent with the revised week and the block's focus.

${SESSION_PURPOSE_RULES}

${ENUM_RULES}

${JSON_RULES}
{
  "today": ${DAY_CONTRACT},
  "tomorrow": ${DAY_CONTRACT},
  "week": ${WEEK_CONTRACT}
}`;

export const WEEKLY_UPDATE_SYSTEM_PROMPT = `You are an expert endurance coach. Create the week starting on the supplied week start date and revise the block plan for an amateur athlete. Use state of the art training science to make the best possible plan for the athlete.

You receive the athlete's profile, recent activities with coach analyses, program reviews, and coach replies, the current season, and the current block. You also receive manually recorded activities, comments on activities, a general weekly note, and coach summaries of completed weeks and blocks with the athlete's feedback on them. Use all of these to judge what the athlete completed, how they responded, how the block's progression should be adjusted, and what constraints or feedback they have for the week. ${ACTIVITY_COMMENT_RULE} The weekly note is a hard constraint: if it says the athlete cannot train on a specific day, move or cancel the session on that day. If a manually recorded activity indicates significant fatigue or extra load, adjust the week's sessions accordingly. The new week must fit the block's focus and progression, must start on the supplied week start date, and must contain exactly seven sessions. For days before today, do not propose new workouts: describe what actually happened and set each status to "completed", "partial", "missed", or "rest". Allow reasonable slack when judging completion: a session with a slightly shorter duration than planned (for example a 60-minute ride recorded as 50 minutes) or slightly missed power/pace zones is still "completed"; use "partial" only when a meaningful part of the session was not done. Include a rationale for the week and for the revised block.

${WEATHER_PLANNING_RULES}

Revise the block's weeks and target loads where the athlete's progress or recent training requires it. Keep the block's name, focus, and dates unless a change is clearly justified. Do not change the season plan.

${ENUM_RULES}

${JSON_RULES}
{
  "week": ${WEEK_CONTRACT},
  "block": ${BLOCK_CONTRACT}
}`;

export const BLOCK_UPDATE_SYSTEM_PROMPT = `You are an expert endurance coach. Create the next block and revise the season plan for an amateur athlete. Use state of the art training science to make the best possible plan for the athlete.

The current block has ended. You receive the athlete's profile, recent activities with coach analyses, program reviews, and coach replies, the current season, the completed block, and the coach summaries of its completed weeks with the athlete's feedback on them. Create the next block starting on the supplied next block start date, consistent with the season goal and any remaining blocks in the season. Revise the season plan to include the new block and adjust upcoming blocks where the athlete's progress requires it. Keep the season goal and completed blocks intact. Include a rationale for the new block and for the revised season.

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
  const weekStart = startOfWeek(input.today);
  const weekEnd = addDays(weekStart, 6);
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
    `The week must start on ${weekStart} and cover ${weekStart} through ${weekEnd}. Keep exactly seven sessions with those dates, and make sure one session has the date ${input.today}; the "today" object must use that same date.`,
    "",
    'Create today\'s session and revise this week\'s remaining sessions. Return one JSON object whose top-level keys are exactly "today", "tomorrow", and "week".',
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
    `Week start date: ${input.weekStartDate}. The week must contain exactly seven sessions dated ${input.weekStartDate} through ${addDays(input.weekStartDate, 6)}.`,
    "",
    "Current season plan:",
    formatSeasonPlan(input.season),
    "",
    "Block plan for the week:",
    formatBlockPlan(input.block),
    "",
    'Create the new week and revise this block. Return one JSON object whose top-level keys are exactly "week" and "block".',
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
    'Create the next block and revise the season plan. Return one JSON object whose top-level keys are exactly "block" and "season".',
  ].join("\n");
}
