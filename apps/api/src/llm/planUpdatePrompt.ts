import type { BlockPlan, SeasonPlan, WeekPlan } from "@killingit/shared";
import { addDays, startOfWeek } from "../plans/dates.js";
import {
  ACTIVITY_COMMENT_RULE,
  BODY_METRIC_RULES,
  formatBlockPlan,
  formatPlanContext,
  formatSeasonPlan,
  formatWeekPlan,
  SESSION_PURPOSE_RULES,
  WEEK_OUTLINE_RULES,
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
  /**
   * The last date that may carry a fully detailed workout. Defaults to
   * tomorrow. The next-period update passes the target day so the day after it
   * stays an outline.
   */
  detailThrough?: string;
}

/** Input for the weekly cascade: the new week plus the current block. */
export interface WeeklyUpdateInput extends BasePlanUpdateInput {
  season: SeasonPlan;
  block: BlockPlan;
  /** Monday of the week being planned (YYYY-MM-DD). */
  weekStartDate: string;
  /** A block that started earlier and must keep this start date. */
  keepBlockStartDate?: string;
}

/** Input for the block cascade: the next block plus the season. */
export interface BlockUpdateInput extends BasePlanUpdateInput {
  season: SeasonPlan;
  block: BlockPlan;
  /** The day after the completed block ends (YYYY-MM-DD). */
  nextBlockStartDate: string;
}

/** Input for refreshing the rest of an existing season from today. */
export interface SeasonRefreshInput extends BasePlanUpdateInput {
  season: SeasonPlan;
  block: BlockPlan;
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
  "estimatedTss": 0,
  "outdoor": true,
  "canBeOutdoor": true,
  "bikeWorkout": {
    "ftpWatts": 0,
    "intervals": [
      {
        "durationSeconds": 0,
        "powerPercent": 75
      }
    ]
  }
}`;

const WEEK_CONTRACT = `{
  "startDate": "YYYY-MM-DD",
  "focus": "string",
  "rationale": "string",
  "estimatedFtpWatts": 0,
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
      "estimatedTss": 0,
      "estimatedFtpWatts": 0,
      "outdoor": true,
      "canBeOutdoor": true,
      "bikeWorkout": {
        "ftpWatts": 0,
        "intervals": [
          {
            "durationSeconds": 0,
            "powerPercent": 75
          }
        ]
      }
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
      "targetLoad": "string",
      "estimatedFtpWatts": 0
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

/** One dated body-composition point in a plan response. */
export const BODY_METRIC_POINT_CONTRACT = `{ "date": "YYYY-MM-DD", "weightKg": 0, "bodyFatPercent": 0 }`;

export const ENUM_RULES = `For every type field use either "workout" or "rest"; for every intensity field use "easy", "moderate", "hard", or "rest". For a rest session set both type and intensity to "rest"; for a workout set type to "workout" and intensity to "easy", "moderate", or "hard". These are exact, lowercase strings: never output a session name such as "run", "strength", or "rest day" as a type, and never copy the "|" choices from the contract into the response.`;
export const JSON_RULES = `Return only a single valid JSON object with exactly this shape. Do not add markdown fences, headings, explanations, or extra fields. Every field must use the exact name and value type shown in the contract. The top-level keys must be exactly the keys shown at the top level of the contract, with the same nesting; never return a bare inner object, an array, or a wrapper such as "plan" or "response". When a contract lists choices separated by "|", output exactly one of those choices as a string and never the list itself. Replace every placeholder such as "YYYY-MM-DD", "string", or 0 with a real value.`;

/**
 * Shared weather and daylight instruction for prompts that choose which day
 * gets which session. The athlete's survey answers define explicit limits;
 * without one, the coach should still place outdoor work sensibly and prefer
 * daylight.
 */
export const WEATHER_PLANNING_RULES = `When a daily forecast is provided, use it to choose which day gets each session. Set "outdoor" to false when this instance is done indoors (gym, treadmill, trainer, pool) and true when it is done outside (running, cycling, hiking, and similar). Set "canBeOutdoor" to false only when the session is tied to indoor equipment or a venue (indoor cycling or trainer, treadmill, gym, pool, rowing machine); set it true when the same session could reasonably be done outdoors (road ride, run, hike, walk), even when you plan this instance indoors. Weather only restricts outdoor sessions.

Read the forecast row for the exact date. Do not describe a day as rainy or snowy, and do not move a flexible session indoors, when that date's forecast is dry and the athlete has no stated preference against training outdoors.

Respect every weather preference or limit the athlete states in their profile. For example, if they will not ride outdoors in rain or when the temperature is below 10 °C, do not schedule such a ride; move it to a suitable day, make it indoor, or replace it with an equivalent session. If the athlete has no weather preference, use common sense: put longer or more demanding outdoor sessions on the best-weather days and shorter or indoor sessions on the poorer days. For example, if Saturday is sunny and Sunday is rainy, schedule a long hike on Saturday and a short run on Sunday.

The daylight times let you keep outdoor work in daylight. Unless the athlete's profile, weekly notes, activity comments, or other input explicitly says they are willing or able to train in the dark, or prefer it, assume the athlete prefers daylight over darkness. Honour any such statement they do make and do not invent a darkness preference they did not state. If the athlete says they can train before or after work on weekdays, compare those training windows with sunrise and sunset. When the only daylight falls inside their working day, so a weekday outdoor session would happen in the dark, put long outdoor sessions at the weekend and keep weekday outdoor sessions within the available daylight or make them indoor.`;

/**
 * Instruction for structured indoor bike workouts. The athlete can download
 * these as a trainer workout file, so the intervals and power targets must be
 * machine-readable rather than only prose.
 */
export const BIKE_WORKOUT_RULES = `When you prescribe an indoor bike workout with power targets (for example a trainer or ERG session), set "outdoor" to false and include "bikeWorkout". "ftpWatts" is the FTP you used; use that day's session "estimatedFtpWatts" when it has one, otherwise the week's value, and when the athlete's profile states no FTP at all, estimate one from their current performance and mention the assumption in the description. List the session in order in "intervals", with each block's "durationSeconds" and its target "powerPercent" of FTP (75 means 75%). Include the warm-up, every work interval, every recovery, and the cool-down as separate entries. Their durations should add up to "durationMinutes" (rounding is fine). Use at most 40 intervals and keep each block at a steady power. For every other session, including outdoor rides and rest days, set "bikeWorkout" to null. If you revise an existing indoor bike session, keep or update its "bikeWorkout" so it still matches the description.`;

/**
 * Shared instruction for the week-by-week FTP estimate and the TSS numbers the
 * API uses when a session has no measured power. The estimate is anchored to
 * the FTP stated in the athlete's profile; without one the feature stays off.
 */
export const TRAINING_LOAD_RULES = `When the athlete's profile states an FTP (functional threshold power), estimate how it will change day by day from the training they have actually completed, their recent form, and the plan's progression. Set "estimatedFtpWatts" on every week session from today onward, including rest days, to your estimate for that date; this daily projection feeds the athlete's FTP chart. Set the week's "estimatedFtpWatts" to the estimate for the day the week is shown from (today in the current week, otherwise the week's first day) so the Week view can show it once. Leave a past session's "estimatedFtpWatts" null. When the response contract also includes the block, set the weekly estimate in every week of the block so the athlete can see the progression. Be realistic: consistent completed load supports small gains, a deload or a missed week holds or reduces the estimate, and you never invent a large jump. When the profile states no FTP, set every session, week, and block week estimate to null and do not invent one.

Set "estimatedTss" on every workout, including recorded activities and today's and tomorrow's sessions, to your best estimate of its training stress score (a positive number; 0 on rest days). Use the session's duration and intensity, the athlete's FTP when known, and any recorded power or heart-rate data. Use roughly 100 for an hour at FTP, 60-70 for an easy aerobic hour, and 20-40 for a short strength session. When measured power is available the app recalculates the number from the recorded effort and the estimated FTP.`;

export const DAILY_UPDATE_SYSTEM_PROMPT = `You are an expert endurance coach. Update today's session, the rest of the current week, and tomorrow's session for an amateur athlete. Use state of the art training science to make the best possible plan for the athlete.

You receive the athlete's profile, recent activities with coach analyses, program reviews, and coach replies, the current season, the current block, and the current week. You also receive manually recorded activities, comments on activities, a general weekly note, and coach summaries of completed weeks and blocks with the athlete's feedback on them. Use all of these to see what the athlete actually completed or missed, how they responded, whether today should be a workout or a rest day, and what constraints or feedback they have for the week. ${ACTIVITY_COMMENT_RULE} Respect the athlete's available time and constraints. The weekly note is a hard constraint: if it says the athlete cannot train on a specific day, move or cancel the session on that day. If a manually recorded activity indicates significant fatigue or extra load, adjust the upcoming sessions accordingly.

Keep the week's start date and exactly seven sessions. For days before today, do not propose new workouts: describe what the athlete actually did using the recent activities and set each status to "completed", "partial", "missed", or "rest". If an activity has already been recorded for today, today's plan must describe that completed activity, using the athlete's latest comment to correct the summary, instead of proposing another workout. The today object must match today's date and must be present as the matching session in week.sessions. Give today's plan and today's week session the same status: "completed" when the recorded activity substantially matched the planned session, or "partial" when only a meaningful part was done. Allow reasonable slack: a 60-minute ride recorded as 50 minutes is still completed, and power or pace zones that are close but not exact do not make a session partial. Revise the remaining sessions so the week stays coherent with the block's focus and the athlete's current fatigue, keeping every day after tomorrow as a short outline. Include a rationale for today's session and for the week's overall structure.

${WEEK_OUTLINE_RULES}

${WEATHER_PLANNING_RULES}

${BIKE_WORKOUT_RULES}

${TRAINING_LOAD_RULES}

${BODY_METRIC_RULES}

Also provide a suggested workout or rest for tomorrow, consistent with the revised week and the block's focus.

${SESSION_PURPOSE_RULES}

${ENUM_RULES}

${JSON_RULES}
{
  "today": ${DAY_CONTRACT},
  "tomorrow": ${DAY_CONTRACT},
  "week": ${WEEK_CONTRACT},
  "bodyMetrics": [${BODY_METRIC_POINT_CONTRACT}]
}`;

export const WEEKLY_UPDATE_SYSTEM_PROMPT = `You are an expert endurance coach. Create the week starting on the supplied week start date and revise the block plan for an amateur athlete. Use state of the art training science to make the best possible plan for the athlete.

You receive the athlete's profile, recent activities with coach analyses, program reviews, and coach replies, the current season, and the current block. You also receive manually recorded activities, comments on activities, a general weekly note, and coach summaries of completed weeks and blocks with the athlete's feedback on them. Use all of these to judge what the athlete completed, how they responded, how the block's progression should be adjusted, and what constraints or feedback they have for the week. ${ACTIVITY_COMMENT_RULE} The weekly note is a hard constraint: if it says the athlete cannot train on a specific day, move or cancel the session on that day. If a manually recorded activity indicates significant fatigue or extra load, adjust the week's sessions accordingly. The new week must fit the block's focus and progression, must start on the supplied week start date, and must contain exactly seven sessions. For days before today, do not propose new workouts: describe what actually happened and set each status to "completed", "partial", "missed", or "rest". Allow reasonable slack when judging completion: a session with a slightly shorter duration than planned (for example a 60-minute ride recorded as 50 minutes) or slightly missed power/pace zones is still "completed"; use "partial" only when a meaningful part of the session was not done. Include a rationale for the week and for the revised block.

${WEEK_OUTLINE_RULES}

${WEATHER_PLANNING_RULES}

${BIKE_WORKOUT_RULES}

${TRAINING_LOAD_RULES}

${BODY_METRIC_RULES}

Revise the block's weeks and target loads where the athlete's progress or recent training requires it. Keep the block's name, focus, and dates unless a change is clearly justified. Do not change the season plan.

${ENUM_RULES}

${JSON_RULES}
{
  "week": ${WEEK_CONTRACT},
  "block": ${BLOCK_CONTRACT},
  "bodyMetrics": [${BODY_METRIC_POINT_CONTRACT}]
}`;

export const BLOCK_UPDATE_SYSTEM_PROMPT = `You are an expert endurance coach. Create the next block and revise the season plan for an amateur athlete. Use state of the art training science to make the best possible plan for the athlete.

The current block has ended. You receive the athlete's profile, recent activities with coach analyses, program reviews, and coach replies, the current season, the completed block, and the coach summaries of its completed weeks with the athlete's feedback on them. Create the next block starting on the supplied next block start date, consistent with the season goal and any remaining blocks in the season. Revise the season plan to include the new block and adjust upcoming blocks where the athlete's progress requires it. Keep the season goal and completed blocks intact. Include a rationale for the new block and for the revised season.

${TRAINING_LOAD_RULES}

${BODY_METRIC_RULES}

${ENUM_RULES}

${JSON_RULES}
{
  "block": ${BLOCK_CONTRACT},
  "season": ${SEASON_CONTRACT},
  "bodyMetrics": [${BODY_METRIC_POINT_CONTRACT}]
}`;

export const SEASON_REFRESH_SYSTEM_PROMPT = `You are an expert endurance coach. Refresh the remaining part of an existing season plan and create the block that starts today for an amateur athlete. Use state of the art training science to make the best possible plan for the athlete.

You receive the athlete's profile, recent activities with coach analyses, program reviews, and coach replies, the existing season plan, and the current block. You also receive manually recorded activities, comments on activities, a general weekly note, and coach summaries of completed weeks and blocks with the athlete's feedback on them. Use all of these to judge their current fitness, fatigue, consistency, goal, available time, and constraints. ${ACTIVITY_COMMENT_RULE}

The season has already started. Blocks that ended before today are complete: keep their summaries exactly as supplied. Refresh the block that contains today in place: keep its existing start date, and re-plan its weeks and progression around what the athlete has actually done. Re-plan the blocks that follow it from scratch. Every later block must start the day after the previous block ends, and the remaining blocks must cover the rest of the season without gaps. Keep the season's goal, start date, and end date unless the athlete's current answers clearly change the goal or end date; never change the season start date. Do not include the completed blocks before today in the returned season.

Create the detailed plan for the block that contains today from its refreshed summary, using that summary's name, focus, dates, and week count. Its weeks must add up to the planned week count. Include a concise rationale for the refreshed season and for the current block.

${TRAINING_LOAD_RULES}

${BODY_METRIC_RULES}

${ENUM_RULES}

${JSON_RULES}
{
  "block": ${BLOCK_CONTRACT},
  "season": ${SEASON_CONTRACT},
  "bodyMetrics": [${BODY_METRIC_POINT_CONTRACT}]
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
  const detailThrough = input.detailThrough ?? addDays(input.today, 1);
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
    `Fully detail the sessions dated ${input.today} through ${detailThrough}. Keep every later session in the week as a short outline.`,
    "",
    'Create today\'s session and revise this week\'s remaining sessions. Return one JSON object whose top-level keys are exactly "today", "tomorrow", "week", and "bodyMetrics".',
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
    "Create all seven days as short outlines; the following daily update will turn each day into a concrete workout when it arrives.",
    ...(input.keepBlockStartDate !== undefined
      ? [
          "",
          `The current block already started on ${input.keepBlockStartDate}. Keep that start date while revising the block.`,
        ]
      : []),
    "",
    "Current season plan:",
    formatSeasonPlan(input.season),
    "",
    "Block plan for the week:",
    formatBlockPlan(input.block),
    "",
    'Create the new week and revise this block. Return one JSON object whose top-level keys are exactly "week", "block", and "bodyMetrics".',
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
    'Create the next block and revise the season plan. Return one JSON object whose top-level keys are exactly "block", "season", and "bodyMetrics".',
  ].join("\n");
}

export function buildSeasonRefreshMessages(input: SeasonRefreshInput): {
  role: "system" | "user";
  content: string;
}[] {
  return [
    { role: "system", content: SEASON_REFRESH_SYSTEM_PROMPT },
    { role: "user", content: buildSeasonRefreshPrompt(input) },
  ];
}

export function buildSeasonRefreshPrompt(input: SeasonRefreshInput): string {
  return [
    ...formatPlanContext(input),
    "",
    "Existing season plan:",
    formatSeasonPlan(input.season),
    "",
    "Current block plan:",
    formatBlockPlan(input.block),
    "",
    `Re-plan the remaining season from today's date, ${input.today}. The current block already started on ${input.block.startDate}; keep that start date while refreshing it. Return the remaining season without the blocks that ended before today.`,
    "",
    'Return one JSON object whose top-level keys are exactly "block", "season", and "bodyMetrics".',
  ].join("\n");
}
