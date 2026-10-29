import type {
  AnalyzedActivity,
  CoachPlan,
  MetricPoint,
} from "@killingit/shared";
import {
  formatActivitySummary,
  formatFtpContext,
  formatPlanLevels,
  formatPlannedSession,
} from "./planContext.js";
import {
  ACTIVITY_FTP_ESTIMATE_RULES,
  ACTIVITY_TYPE_RULE,
  COACH_ANALYSIS_RESPONSE_RULES,
  ONLY_STATED_NUMBERS_RULE,
} from "./promptRules.js";

/**
 * Bump when the review prompt or generation parameters change materially. Cached
 * program reviews from an older version are ignored and regenerated.
 */
export const PROGRAM_ANALYSIS_PROMPT_VERSION = 6;

export interface ProgramAnalysisInput {
  today: string;
  plan: CoachPlan;
  activity: AnalyzedActivity;
  /** The athlete's comment on this activity, when there is one. */
  comment?: string | null;
  /** The stored FTP time series, oldest first, including coach estimates. */
  ftpHistory?: readonly Pick<MetricPoint, "date" | "value" | "source">[];
  /** The FTP in effect on the activity date, when known. */
  currentFtpWatts?: number | null;
}

const PROGRAM_ANALYSIS_SYSTEM_PROMPT = `You are an experienced endurance coach reviewing one completed workout against the athlete's current training program.
${ACTIVITY_TYPE_RULE}
Match the workout to a planned session, then weave how well it fit the plan into one brief summary rather than a separate section. Be encouraging when the workout was at least somewhat conforming, but do not hesitate to point out what could be improved. Cite only the most useful numbers.
Use 2-3 sentences of plain text and finish with one actionable takeaway. Do not use headings, bullets, or markdown.
${ACTIVITY_FTP_ESTIMATE_RULES}
When the athlete's comment on this activity states their body weight or body-fat percentage, report it in "weightKg" and "bodyFatPercent". ${ONLY_STATED_NUMBERS_RULE}

${COACH_ANALYSIS_RESPONSE_RULES}`;

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
    "Write a brief summary that includes how well this activity fit its planned session and what could be done better. Return the JSON object described in the system prompt.",
  );
  return lines.join("\n");
}
