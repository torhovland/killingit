import type {
  BlockPlan,
  DayPlan,
  SeasonPlan,
  WeekPlan,
} from "@killingit/shared";
import { addDays, startOfWeek } from "../plans/dates.js";
import {
  ACTIVITY_COMMENT_RULE,
  BODY_METRIC_RULES,
  formatBlockPlan,
  formatDayPlan,
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

/**
 * The levels the app is asking the coach to revise in one update. Every level
 * is still supplied as input, so the coach can keep the plan coherent, but only
 * the flagged levels need to change.
 */
export interface PlanUpdateRevision {
  /** Refresh the remaining season and the current block in place. */
  season: boolean;
  /** Create or revise the current block. */
  block: boolean;
  /** Revise the current week. */
  week: boolean;
  /** Create or revise today's session. */
  day: boolean;
  /** Return tomorrow's session. */
  tomorrow: boolean;
  /** Create the week that contains tomorrow. */
  nextWeek: boolean;
  /** Create the block that contains tomorrow. */
  nextBlock: boolean;
}

/** Input for the single prompt that updates any level of the plan. */
export interface PlanUpdateInput extends BasePlanUpdateInput {
  season: SeasonPlan;
  block: BlockPlan;
  week: WeekPlan;
  todayPlan: DayPlan;
  tomorrow: DayPlan | null;
  nextWeek: WeekPlan | null;
  nextBlock: BlockPlan | null;
  revision: PlanUpdateRevision;
  /** The date the revised current block must start on. */
  blockStartDate?: string;
  /** Revise the current block in place instead of creating a new one. */
  reviseBlock?: boolean;
  /** The date the next block must start on. */
  nextBlockStartDate?: string;
  /** The Monday the next week must start on. */
  nextWeekStartDate?: string;
}

/** The seven calendar dates a Monday-based week must contain. */
function weekDates(startDate: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(startDate, index));
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

const PLAN_UPDATE_CONTRACT = `{
  "season": ${SEASON_CONTRACT},
  "block": ${BLOCK_CONTRACT},
  "week": ${WEEK_CONTRACT},
  "today": ${DAY_CONTRACT},
  "tomorrow": ${DAY_CONTRACT} | null,
  "nextWeek": ${WEEK_CONTRACT} | null,
  "nextBlock": ${BLOCK_CONTRACT} | null,
  "bodyMetrics": [${BODY_METRIC_POINT_CONTRACT}]
}`;

export const RATIONALE_RULES = `Every "rationale" field explains the plan as it stands after the revision, not the act of revising it. Explain why this goal, season shape, block, week, session, or rest day is right for the athlete from this point forward, using the latest training and feedback. Do not describe the previous plan, what changed, or why the plan was revised. Do not write phrases such as "we adjusted", "we changed", "this replaces", or "because of the new review". State the current rationale directly.`;

export const PLAN_UPDATE_SYSTEM_PROMPT = `You are an expert endurance coach. Update an athlete's training plan. Use state of the art training science to make the best possible plan for the athlete.

You receive the complete current plan at every level: the season, the current block, the current week, today's session, tomorrow's session when one has been planned, the next week when one has been planned, and the next block when one has been planned. You also receive the athlete's profile, recent activities with coach analyses, program reviews, and coach replies, manually recorded activities, comments on activities, a general weekly note, and coach summaries of completed weeks and blocks with the athlete's feedback on them. Use all of these to see what the athlete actually completed or missed, how they responded, whether today should be a workout or a rest day, and what constraints or feedback they have for the week. ${ACTIVITY_COMMENT_RULE} Respect the athlete's available time and constraints. The weekly note is a hard constraint: if it says the athlete cannot train on a specific day, move or cancel the session on that day. If a manually recorded activity indicates significant fatigue or extra load, adjust the upcoming sessions accordingly.

The revision request lists the levels that need to change. Return every level in the contract, so the saved plan always has a coherent season, block, week and day:
- Keep the season, block, week, today, tomorrow, next week and next block exactly as supplied unless the request names them. Keep a level that is null and not requested as null.
- When the current block is revised, return the revised block, a revised current week that fits it, and today's detailed session. Keep the current block's start date when the request says to keep it; otherwise start the new block on the supplied block start date. When a completed week review or its answer is supplied, use that feedback to adjust the block's progression. Update the season block summaries only when the revised block changes them.
- When the season is refreshed, keep the blocks that ended before today exactly as supplied, keep the current block's existing start date, re-plan the rest of the season from the current block, and return the detailed current block. Later blocks must follow one another without gaps and cover the rest of the season.
- When the current week is revised, change the remaining sessions so the week stays coherent with the block's focus and the athlete's current fatigue. Keep every day after tomorrow as a short outline. If only today's session is revised, update today's session in the week while keeping the rest of the week as supplied.
- If the current block is revised, or the current week is re-planned under a next block that starts tomorrow, keep today's session unchanged unless the request also revises today.
- When tomorrow is requested, return it and make sure it is the matching session in the current week or, when it falls in the next week, in the next week. Respect every weather preference and daylight constraint.
- When the next week is requested, start it on the supplied next week start date and give it exactly seven sessions. When the next block is requested, start it on the supplied next block start date and put it in "nextBlock"; update "season" so its block summaries include it. If the block that starts tomorrow falls inside the current week, re-plan the remaining days of the current week under that next block and keep today's session.
- For days before today, do not propose new workouts: describe what the athlete actually did and set each status to "completed", "partial", "missed", or "rest". If an activity has already been recorded for today, today's plan must describe that completed activity, using the athlete's latest comment to correct the summary, instead of proposing another workout. Allow reasonable slack when judging completion: a 60-minute ride recorded as 50 minutes is still completed, and power or pace zones that are close but not exact do not make a session partial.
- Give today's plan and today's week session the same status. Include a rationale for today's session and for the week's overall structure.

${RATIONALE_RULES}

${WEEK_OUTLINE_RULES}

${WEATHER_PLANNING_RULES}

${BIKE_WORKOUT_RULES}

${TRAINING_LOAD_RULES}

${BODY_METRIC_RULES}

${SESSION_PURPOSE_RULES}

${ENUM_RULES}

${JSON_RULES}
${PLAN_UPDATE_CONTRACT}`;

function revisionInstructions(input: PlanUpdateInput): string[] {
  const lines = ["Revision request:"];
  if (input.revision.season) {
    lines.push(
      `- Refresh the season and the current block in place. The current block must start on ${input.blockStartDate ?? input.block.startDate} and keep the blocks that ended before today unchanged. Return the remaining season in "season" and the detailed current block in "block".`,
    );
  } else if (input.revision.block && input.reviseBlock) {
    lines.push(
      `- Revise the current block in place: keep its start date (${input.blockStartDate ?? input.block.startDate}) and update its weeks and target loads where the completed week's review or the athlete's feedback requires it. Return it in "block" and update the season's block summaries if they change.`,
    );
  } else if (input.revision.block) {
    lines.push(
      `- Create the current block starting on ${input.blockStartDate ?? input.block.startDate}. Return it in "block" and update the season's block summaries if the new block changes them.`,
    );
  } else {
    lines.push(
      "- Keep the current block and the season block summaries unchanged.",
    );
  }
  lines.push(
    input.revision.week
      ? '- Revise the current week and return it in "week".'
      : "- Keep the current week unchanged, apart from today's session if it is revised.",
  );
  lines.push(
    input.revision.day
      ? '- Create or revise today\'s session and return it in "today".'
      : "- Keep today's session as supplied.",
  );
  lines.push(
    input.revision.tomorrow
      ? '- Return tomorrow\'s session in "tomorrow" and place it in the current week or the next week.'
      : "- Keep tomorrow's session as supplied, or null when there is none.",
  );
  lines.push(
    input.revision.nextWeek
      ? `- Create the next week starting on ${input.nextWeekStartDate ?? startOfWeek(addDays(input.today, 1))} and return it in "nextWeek".`
      : "- Keep the next week as supplied, or null when there is none.",
  );
  lines.push(
    input.revision.nextBlock
      ? `- Create the next block starting on ${input.nextBlockStartDate ?? input.block.endDate} and return it in "nextBlock".`
      : "- Keep the next block as supplied, or null when there is none.",
  );
  return lines;
}

export function buildPlanUpdateMessages(input: PlanUpdateInput): {
  role: "system" | "user";
  content: string;
}[] {
  return [
    { role: "system", content: PLAN_UPDATE_SYSTEM_PROMPT },
    { role: "user", content: buildPlanUpdatePrompt(input) },
  ];
}

export function buildPlanUpdatePrompt(input: PlanUpdateInput): string {
  const weekStart = startOfWeek(input.today);
  const weekEnd = addDays(weekStart, 6);
  const tomorrowDate = addDays(input.today, 1);
  const nextWeekStart = startOfWeek(tomorrowDate);
  const detailedDates = input.revision.tomorrow
    ? `${input.today} and ${tomorrowDate}`
    : input.today;
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
    "Today's plan:",
    formatDayPlan(input.todayPlan),
    "",
    "Tomorrow's plan:",
    input.tomorrow === null
      ? "Not planned yet."
      : formatDayPlan(input.tomorrow),
    "",
    "Next week plan:",
    input.nextWeek === null
      ? "Not planned yet."
      : formatWeekPlan(input.nextWeek),
    "",
    "Next block plan:",
    input.nextBlock === null
      ? "Not planned yet."
      : formatBlockPlan(input.nextBlock),
    "",
    `The current week must start on ${weekStart} and cover ${weekStart} through ${weekEnd}. Keep exactly seven sessions with those dates, and make sure one session has the date ${input.today}; the "today" object must use that same date and be one of the current week's sessions.`,
    `Tomorrow is ${tomorrowDate}.`,
    `Fully detail the sessions dated ${detailedDates}. Keep every later session in the current week as a short outline.`,
    "",
    ...revisionInstructions(input),
    ...(input.revision.nextWeek
      ? [
          "",
          `The next week must start on ${nextWeekStart} and contain exactly seven sessions dated ${weekDates(nextWeekStart).join(", ")}.`,
        ]
      : []),
    "",
    'Return one JSON object whose top-level keys are exactly "season", "block", "week", "today", "tomorrow", "nextWeek", "nextBlock", and "bodyMetrics".',
  ].join("\n");
}

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
