import type {
  BlockPlan,
  DayPlan,
  SeasonPlan,
  WeekPlan,
} from "@killingit/shared";
import { addDays, startOfWeek, weekDates } from "../plans/dates.js";
import {
  formatBlockPlan,
  formatDayPlan,
  formatPlanContext,
  formatPlanLevels,
  formatSeasonAndBlock,
  formatWeekPlan,
  type PlanContextInput,
} from "./planContext.js";
import {
  BIKE_WORKOUT_RULES,
  BODY_METRIC_POINT_CONTRACT,
  BLOCK_CONTRACT,
  COMPLETED_SESSION_RULES,
  COMPLETION_SLACK_RULES,
  DAY_CONTRACT,
  ENUM_RULES,
  JSON_RULES,
  jsonTopLevelKeys,
  PAST_SESSION_RULES,
  PLAN_PROMPT_GLOBAL_RULES,
  promptSections,
  SEASON_CONTRACT,
  SESSION_PURPOSE_RULES,
  TODAY_IN_WEEK_RULE,
  TRAINING_LOAD_RULES,
  WEEK_CONTRACT,
  WEEK_OUTLINE_RULES,
  WEEK_SHAPE_RULES,
  WEATHER_PLANNING_RULES,
} from "./promptRules.js";

/** Input for the daily cascade: today plus the current week. */
export interface DailyUpdateInput extends PlanContextInput {
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
export interface WeeklyUpdateInput extends PlanContextInput {
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
export interface PlanUpdateInput extends PlanContextInput {
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

export const DAILY_UPDATE_SYSTEM_PROMPT = promptSections(
  PLAN_PROMPT_GLOBAL_RULES,
  "Update today's session, the rest of the current week, and tomorrow's session for an amateur athlete.",
  "Revise the remaining sessions so the week stays coherent with the block's focus and the athlete's current fatigue, keeping every day after tomorrow as a short outline. Include a rationale for today's session and for the week's overall structure.",
  "Also provide a suggested workout or rest for tomorrow, consistent with the revised week and the block's focus.",
  WEEK_SHAPE_RULES,
  TODAY_IN_WEEK_RULE,
  COMPLETED_SESSION_RULES,
  WEEK_OUTLINE_RULES,
  SESSION_PURPOSE_RULES,
  WEATHER_PLANNING_RULES,
  BIKE_WORKOUT_RULES,
  TRAINING_LOAD_RULES,
  ENUM_RULES,
  JSON_RULES,
  `{
  "today": ${DAY_CONTRACT},
  "tomorrow": ${DAY_CONTRACT},
  "week": ${WEEK_CONTRACT},
  "bodyMetrics": [${BODY_METRIC_POINT_CONTRACT}]
}`,
);

export const WEEKLY_UPDATE_SYSTEM_PROMPT = promptSections(
  PLAN_PROMPT_GLOBAL_RULES,
  "Create the week starting on the supplied week start date and revise the block plan for an amateur athlete.",
  "The new week must fit the block's focus and progression. Include a rationale for the week and for the revised block.",
  "Revise the block's weeks and target loads where the athlete's progress or recent training requires it. Keep the block's name, focus, and dates unless a change is clearly justified. Do not change the season plan.",
  WEEK_SHAPE_RULES,
  PAST_SESSION_RULES,
  COMPLETION_SLACK_RULES,
  WEEK_OUTLINE_RULES,
  WEATHER_PLANNING_RULES,
  BIKE_WORKOUT_RULES,
  TRAINING_LOAD_RULES,
  ENUM_RULES,
  JSON_RULES,
  `{
  "week": ${WEEK_CONTRACT},
  "block": ${BLOCK_CONTRACT},
  "bodyMetrics": [${BODY_METRIC_POINT_CONTRACT}]
}`,
);

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

export const PLAN_UPDATE_SYSTEM_PROMPT = promptSections(
  PLAN_PROMPT_GLOBAL_RULES,
  "Update an athlete's training plan.",
  "You receive the complete current plan at every level: the season, the current block, the current week, today's session, tomorrow's session when one has been planned, the next week when one has been planned, and the next block when one has been planned.",
  `The revision request lists the levels that need to change. Return every level in the contract, so the saved plan always has a coherent season, block, week and day:
- Keep the season, block, week, today, tomorrow, next week and next block exactly as supplied unless the request names them. Keep a level that is null and not requested as null.
- When the current block is revised, return the revised block, a revised current week that fits it, and today's detailed session. Keep the current block's start date when the request says to keep it; otherwise start the new block on the supplied block start date. When a completed week review or its answer is supplied, use that feedback to adjust the block's progression. Update the season block summaries only when the revised block changes them.
- When the season is refreshed, keep the blocks that ended before today exactly as supplied, keep the current block's existing start date, re-plan the rest of the season from the current block, and return the detailed current block. Later blocks must follow one another without gaps and cover the rest of the season.
- When the current week is revised, change the remaining sessions so the week stays coherent with the block's focus and the athlete's current fatigue. Keep every day after tomorrow as a short outline. If only today's session is revised, update today's session in the week while keeping the rest of the week as supplied.
- If the current block is revised, or the current week is re-planned under a next block that starts tomorrow, keep today's session unchanged unless the request also revises today.
- When tomorrow is requested, return it and make sure it is the matching session in the current week or, when it falls in the next week, in the next week. Respect every weather preference and daylight constraint.
- When the next week is requested, start it on the supplied next week start date and give it exactly seven sessions. When the next block is requested, start it on the supplied next block start date and put it in "nextBlock"; update "season" so its block summaries include it. If the block that starts tomorrow falls inside the current week, re-plan the remaining days of the current week under that next block and keep today's session.
- Include a rationale for today's session and for the week's overall structure.`,
  WEEK_SHAPE_RULES,
  TODAY_IN_WEEK_RULE,
  COMPLETED_SESSION_RULES,
  WEEK_OUTLINE_RULES,
  SESSION_PURPOSE_RULES,
  WEATHER_PLANNING_RULES,
  BIKE_WORKOUT_RULES,
  TRAINING_LOAD_RULES,
  ENUM_RULES,
  JSON_RULES,
  PLAN_UPDATE_CONTRACT,
);

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
    ...formatPlanLevels(input),
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
    jsonTopLevelKeys([
      "season",
      "block",
      "week",
      "today",
      "tomorrow",
      "nextWeek",
      "nextBlock",
      "bodyMetrics",
    ]),
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
    ...formatPlanLevels(input),
    "",
    `The week must start on ${weekStart} and cover ${weekStart} through ${weekEnd}. Keep exactly seven sessions with those dates, and make sure one session has the date ${input.today}; the "today" object must use that same date.`,
    "",
    `Fully detail the sessions dated ${input.today} through ${detailThrough}. Keep every later session in the week as a short outline.`,
    "",
    "Create today's session and revise this week's remaining sessions.",
    jsonTopLevelKeys(["today", "tomorrow", "week", "bodyMetrics"]),
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
    ...formatSeasonAndBlock(input.season, input.block),
    "",
    "Create the new week and revise this block.",
    jsonTopLevelKeys(["week", "block", "bodyMetrics"]),
  ].join("\n");
}
