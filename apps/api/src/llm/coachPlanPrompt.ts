import type { AnalyzedActivity } from "@killingit/shared";
import {
  formatPlanContext,
  type PlanContextInput,
  type RecentActivityContext,
} from "./planContext.js";
import {
  BIKE_WORKOUT_RULES,
  BODY_METRIC_POINT_CONTRACT,
  BLOCK_CONTRACT,
  COMPLETED_SESSION_RULES,
  DAY_CONTRACT,
  ENUM_RULES,
  JSON_RULES,
  jsonTopLevelKeys,
  GLOBAL_PROMPT_RULES,
  PLAN_PROMPT_RULES,
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

/**
 * Bump when the plan prompt or its generation parameters change materially, so
 * callers can invalidate cached plans the same way activity analyses are
 * versioned.
 */
export const COACH_PLAN_PROMPT_VERSION = 10;

export type CoachPlanActivity = RecentActivityContext;

/**
 * The combined plan prompt shares the regular plan context: the athlete's
 * profile, recent activities with their reviews, today's date and the optional
 * timezone.
 */
export type CoachPlanInput = PlanContextInput;

/**
 * The exact JSON the model must return. Built from the same level contracts as
 * every other plan prompt, so the combined plan can never drift from them.
 */
const COACH_PLAN_RESPONSE_CONTRACT = `{
  "season": ${SEASON_CONTRACT},
  "block": ${BLOCK_CONTRACT},
  "week": ${WEEK_CONTRACT},
  "today": ${DAY_CONTRACT},
  "tomorrow": ${DAY_CONTRACT},
  "bodyMetrics": [${BODY_METRIC_POINT_CONTRACT}]
}`;

export const COACH_PLAN_SYSTEM_PROMPT = promptSections(
  GLOBAL_PROMPT_RULES,
  PLAN_PROMPT_RULES,
  "Design a personalised, periodised training plan for an amateur athlete.",
  "Apply the principles that current research and elite practice agree on: individualisation, progressive overload, specificity, periodisation, adequate recovery, and a taper before the main goal. Prefer sustainable, injury-free progress over quick fixes.",
  "Use the recent activities and analyses to judge current fitness, fatigue, consistency, and the next sensible stimulus.",
  `Create a consistent plan at every level:
1. season — the overall season with its goal, dates, blocks, and a rationale explaining the season's shape.
2. block — the first block of the season, with its weeks, progression, and a rationale.
3. week — the first week of that block, with one session for each day, a rationale, and per-session status.
4. today — the concrete workout or rest for today, with a rationale and an optionality assessment.
5. tomorrow — the suggested workout or rest for tomorrow, with a rationale and an optionality assessment.`,
  "Fully detail today's and tomorrow's sessions; keep every later day in the week as a short outline.",
  "The season starts on the supplied today date. The block is the first entry in season.blocks. The week is the first week in block.weeks, so block.weeks[0].startDate and week.startDate must match.",
  "Respect the athlete's available training days and hours, and include rest days where they are the best choice.",
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
  COACH_PLAN_RESPONSE_CONTRACT,
);

/** Adapts an analyzed activity for the plan prompt. */
export function toCoachPlanActivity(
  activity: AnalyzedActivity,
): CoachPlanActivity {
  return {
    summary: activity,
    analysis: activity.analysis?.text ?? null,
    programAnalysis: activity.programAnalysis?.text ?? null,
    coachReply: activity.coachReply?.text ?? null,
  };
}

/** Builds the chat messages that ask the coach for the complete plan. */
export function buildCoachPlanMessages(input: CoachPlanInput): {
  role: "system" | "user";
  content: string;
}[] {
  return [
    { role: "system", content: COACH_PLAN_SYSTEM_PROMPT },
    { role: "user", content: buildCoachPlanPrompt(input) },
  ];
}

/** Exposed for tests and for inspecting exactly what is sent to the model. */
export function buildCoachPlanPrompt(input: CoachPlanInput): string {
  return [
    ...formatPlanContext(input),
    "",
    "Using the athlete profile and recent training, create the season plan, the first block, the first week, and today's session.",
    jsonTopLevelKeys([
      "season",
      "block",
      "week",
      "today",
      "tomorrow",
      "bodyMetrics",
    ]),
  ].join("\n");
}
