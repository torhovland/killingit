import type {
  AnalyzedActivity,
  CoachPlan,
  DailyHealthPoint,
  MetricPoint,
  ThresholdSummary,
} from "@killingit/shared";
import type { DietPromptContext } from "../diet/summary.js";
import { formatDailyHealthContext } from "./healthContext.js";
import {
  formatActivitySummary,
  formatBodyHistory,
  formatDietContext,
  formatFtpContext,
  formatPlanLevels,
  formatPlannedSession,
  formatThresholdContext,
  type BodyMetricHistory,
} from "./planContext.js";
import {
  ACTIVITY_BODY_METRIC_RULES,
  ACTIVITY_FTP_ESTIMATE_RULES,
  ACTIVITY_TYPE_RULE,
  COACH_ANALYSIS_RESPONSE_RULES,
  DAILY_HEALTH_RULES,
  DIET_RULES,
  DURATION_TOLERANCE_RULES,
  GLOBAL_PROMPT_RULES,
  promptSections,
  LAP_STRUCTURE_RULES,
  STRENGTH_SET_RULES,
  TEXT_FORMATTING_RULES,
  RETURN_JSON_FROM_SYSTEM_PROMPT,
} from "./promptRules.js";

/**
 * Bump when the review prompt or generation parameters change materially. Cached
 * program reviews from an older version are ignored and regenerated.
 */
export const PROGRAM_ANALYSIS_PROMPT_VERSION = 15;

export interface ProgramAnalysisInput {
  today: string;
  plan: CoachPlan;
  activity: AnalyzedActivity;
  /** The athlete's comment on this activity, when there is one. */
  comment?: string | null;
  /** The stored FTP threshold history, oldest first, including coach estimates. */
  ftpHistory?: readonly Pick<MetricPoint, "date" | "value" | "source">[];
  /** The FTP in effect on the activity date, when known. */
  currentFtpWatts?: number | null;
  /** Every threshold measure in effect on the activity date. */
  thresholds?: readonly ThresholdSummary[];
  /** Daily health and recovery values, filtered through the activity date. */
  dailyHealth?: readonly DailyHealthPoint[];
  /** Stored body weight and body-fat history, including Garmin weigh-ins. */
  bodyHistory?: BodyMetricHistory;
  /** Meals from the last seven days and completed-week summaries. */
  diet?: DietPromptContext;
}

const PROGRAM_ANALYSIS_SYSTEM_PROMPT = promptSections(
  GLOBAL_PROMPT_RULES,
  "Review one completed workout against the athlete's current training program.",
  ACTIVITY_TYPE_RULE,
  "Match the workout to a planned session, then weave how well it fit the plan into one brief summary rather than a separate section. Be encouraging when the workout was at least somewhat conforming, but do not hesitate to point out what could genuinely be improved. Cite only the most useful numbers.",
  DURATION_TOLERANCE_RULES,
  "Use 2-3 sentences and finish with one actionable takeaway. Use a short bullet list when the workout has several points worth noting. The takeaway must follow from a real improvement: when the workout went to plan, build on it instead of inventing a correction.",
  STRENGTH_SET_RULES,
  LAP_STRUCTURE_RULES,
  DAILY_HEALTH_RULES,
  DIET_RULES,
  ACTIVITY_FTP_ESTIMATE_RULES,
  ACTIVITY_BODY_METRIC_RULES,
  TEXT_FORMATTING_RULES,
  COACH_ANALYSIS_RESPONSE_RULES,
);

/** Builds the chat messages for a program-aware activity review. */
export function buildProgramAnalysisMessages(input: ProgramAnalysisInput): {
  role: "system" | "user";
  content: string;
}[] {
  return [
    { role: "system", content: PROGRAM_ANALYSIS_SYSTEM_PROMPT },
    { role: "user", content: buildProgramAnalysisPrompt(input) },
  ];
}

/** Exposed for tests and for inspecting exactly what is sent to the model. */
export function buildProgramAnalysisPrompt(
  input: ProgramAnalysisInput,
): string {
  const { plan, activity } = input;
  const activityDate = activity.startDate.slice(0, 10);
  const plannedSession = plan.week.sessions.find(
    (session) => session.date === activityDate,
  );

  const lines = [
    `Today's date: ${input.today}`,
    "",
    ...formatPlanLevels(plan),
    "",
    plannedSession
      ? `Planned session for ${activityDate}: ${formatPlannedSession(plannedSession)}`
      : `No session was planned for ${activityDate}. Match the activity to another session in this week if its data fits one.`,
    "",
  ];

  if (input.currentFtpWatts !== undefined && input.currentFtpWatts !== null) {
    lines.push(`Current FTP: ${input.currentFtpWatts} W`, "");
  }
  if (input.ftpHistory !== undefined && input.ftpHistory.length > 0) {
    lines.push(...formatFtpContext(input.ftpHistory), "");
  }
  if (input.thresholds !== undefined && input.thresholds.length > 0) {
    lines.push(...formatThresholdContext(input.thresholds), "");
  }
  if (input.bodyHistory !== undefined) {
    lines.push(...formatBodyHistory(input.bodyHistory, activityDate));
  }
  if (input.dailyHealth !== undefined) {
    lines.push(
      ...formatDailyHealthContext(input.dailyHealth, activityDate, {
        today: input.today,
      }),
      "",
    );
  }
  if (input.diet !== undefined) {
    lines.push(...formatDietContext(input.diet, input.today), "");
  }

  lines.push(
    "Completed activity:",
    ...formatActivitySummary(activity, activity.sampleCount),
  );

  if (activity.analysis !== null) {
    lines.push(`- General coach analysis: ${activity.analysis.text.trim()}`);
  }
  if (input.comment !== undefined && input.comment !== null) {
    lines.push(`- Athlete comment: ${input.comment.trim()}`);
  }

  lines.push(
    "",
    "Write a brief summary that includes how well this activity fit its planned session and what could be done better.",
    RETURN_JSON_FROM_SYSTEM_PROMPT,
  );
  return lines.join("\n");
}
