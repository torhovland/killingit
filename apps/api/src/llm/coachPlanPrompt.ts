import type { AnalyzedActivity } from "@killingit/shared";
import {
  formatAthleteAnswers,
  formatRecentActivities,
  type AthleteAnswerContext,
  type RecentActivityContext,
} from "./planContext.js";

/**
 * Bump when the plan prompt or its generation parameters change materially, so
 * callers can invalidate cached plans the same way activity analyses are
 * versioned.
 */
export const COACH_PLAN_PROMPT_VERSION = 1;

export type CoachPlanAthleteAnswer = AthleteAnswerContext;
export type CoachPlanActivity = RecentActivityContext;

export interface CoachPlanInput {
  /** The athlete's interview answers, in display order. */
  athleteAnswers: readonly AthleteAnswerContext[];
  /** Recent activities, most recent first, with their coach analyses. */
  recentActivities: readonly RecentActivityContext[];
  /** The date the plan starts, as `YYYY-MM-DD`. */
  today: string;
  /** The athlete's IANA timezone, when known. */
  timezone?: string;
}

/**
 * The exact JSON the model must return. Keeping the four levels in one object
 * avoids drift between the season, its first block, the first week, and today.
 */
const COACH_PLAN_RESPONSE_CONTRACT = `{
  "season": {
    "goal": "string",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "rationale": "string",
    "blocks": [
      {
        "name": "string",
        "focus": "string",
        "startDate": "YYYY-MM-DD",
        "endDate": "YYYY-MM-DD",
        "weekCount": 0
      }
    ]
  },
  "block": {
    "name": "string",
    "focus": "string",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "rationale": "string",
    "weeks": [
      {
        "number": 1,
        "startDate": "YYYY-MM-DD",
        "focus": "string",
        "targetLoad": "string"
      }
    ]
  },
  "week": {
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
  },
  "today": {
    "date": "YYYY-MM-DD",
    "type": "workout | rest",
    "title": "string",
    "description": "string",
    "durationMinutes": 0,
    "intensity": "easy | moderate | hard | rest",
    "alternatives": ["string"],
    "rationale": "string"
  },
  "tomorrow": {
    "date": "YYYY-MM-DD",
    "type": "workout | rest",
    "title": "string",
    "description": "string",
    "durationMinutes": 0,
    "intensity": "easy | moderate | hard | rest",
    "alternatives": ["string"],
    "rationale": "string"
  }
}`;

export const COACH_PLAN_SYSTEM_PROMPT = `You are an expert endurance coach designing a personalised, periodised training plan for an amateur athlete. Use state of the art training science to make the best possible plan that fulfils the athlete's needs. Apply the principles that current research and elite practice agree on: individualisation, progressive overload, specificity, periodisation, adequate recovery, and a taper before the main goal. Prefer sustainable, injury-free progress over quick fixes.

You receive the athlete's questionnaire answers and a summary of their recent training, including coach analyses. Use the answers to understand their goal, available time, experience, preferences, and constraints. Use the recent activities and analyses to judge current fitness, fatigue, consistency, and the next sensible stimulus. Do not invent facts that are not in the input. When an important detail is missing, make a conservative assumption and state it briefly in the relevant focus or description.

Create four consistent levels of the plan:
1. season — the overall season with its goal, dates, blocks, and a rationale explaining the season's shape.
2. block — the first block of the season, with its weeks, progression, and a rationale.
3. week — the first week of that block, with one session for each day, a rationale, and per-session status.
4. today — the concrete workout or rest for today, with a rationale.
5. tomorrow — the suggested workout or rest for tomorrow, with a rationale.

The season starts on the supplied today date. The block is the first entry in season.blocks. The week is the first week in block.weeks, so block.weeks[0].startDate and week.startDate must match. week.sessions must contain exactly seven entries, one for each day of that week, and today must match the entry for today's date in week.sessions. For days before today, do not propose new workouts: describe what actually happened using the activities and set each status to "completed", "missed", or "rest". Respect the athlete's available training days and hours, and include rest days where they are the best choice.

For every type field use either "workout" or "rest"; for every intensity field use "easy", "moderate", "hard", or "rest".

Return only a single valid JSON object with exactly this shape. Do not add markdown fences, headings, explanations, or extra fields.
${COACH_PLAN_RESPONSE_CONTRACT}`;

/** Adapts an analyzed activity for the plan prompt. */
export function toCoachPlanActivity(
  activity: AnalyzedActivity,
): CoachPlanActivity {
  return {
    summary: activity,
    analysis: activity.analysis?.text ?? null,
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
  const lines: string[] = [`Today's date: ${input.today}`];
  if (input.timezone !== undefined && input.timezone.trim() !== "") {
    lines.push(`Athlete timezone: ${input.timezone.trim()}`);
  }

  lines.push(
    "",
    "Athlete profile:",
    formatAthleteAnswers(input.athleteAnswers),
  );

  lines.push(
    "",
    "Recent activities (most recent first):",
    formatRecentActivities(input.recentActivities),
  );

  lines.push(
    "",
    "Using the athlete profile and recent training, create the season plan, the first block, the first week, and today's session. Use state of the art training science to make the best possible plan for this athlete. Return only the JSON object described in the system prompt.",
  );
  return lines.join("\n");
}
