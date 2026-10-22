import type { AnalyzedActivity, CoachPlan } from "@killingit/shared";
import { formatDuration } from "./activityPrompt.js";
import {
  formatBlockPlan,
  formatSeasonPlan,
  formatWeekPlan,
} from "./planContext.js";

/**
 * Bump when the review prompt or generation parameters change materially. Cached
 * program reviews from an older version are ignored and regenerated.
 */
export const PROGRAM_ANALYSIS_PROMPT_VERSION = 2;

export interface ProgramAnalysisInput {
  today: string;
  plan: CoachPlan;
  activity: AnalyzedActivity;
  /** The athlete's comment on this activity, when there is one. */
  comment?: string | null;
}

const PROGRAM_ANALYSIS_SYSTEM_PROMPT = `You are an experienced endurance coach reviewing one completed workout against the athlete's current training program.
The activity type recorded by the device is only a label and may be wrong: do not trust it. If the heart-rate data looks erratic — sudden spikes or drops that do not fit the steady effort the summary suggests — this may be a strength-training workout even when the device labelled it as running, cycling, or another endurance activity.
Match the workout to a planned session: the session planned for its date, today's planned session, or any other session this week whose type, duration, intensity, and effort pattern fit. Say which session you matched and why, or state that it does not match any planned session. Then explain how well the workout fit the program: did it serve the block and week's intent, was the load and intensity right, and did it fit the athlete's recent training? Then say what could have been done better, or confirm the workout was well executed. Cite specific numbers from the activity data and refer to the planned session when it is useful.
Finish with one clear, actionable takeaway for the next comparable session.
Reply with 3-5 sentences of plain text. Do not use headings, bullets, or markdown.`;

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
    "Season plan:",
    formatSeasonPlan(plan.season),
    "",
    "Current block plan:",
    formatBlockPlan(plan.block),
    "",
    "Current week plan:",
    formatWeekPlan(plan.week),
    "",
    plannedSession
      ? `Planned session for ${activityDate}: ${plannedSession.title} [${plannedSession.type}, ${plannedSession.intensity}, ${plannedSession.durationMinutes} min] — ${plannedSession.description}`
      : `No session was planned for ${activityDate}. Match the activity to another session in this week if its data fits one.`,
    "",
    "Completed activity:",
    `- Date: ${activityDate}`,
    `- Name: ${activity.name}`,
    `- Type (recorded by the device; may be wrong): ${activity.type}`,
    `- Distance: ${(activity.distance / 1000).toFixed(2)} km`,
    `- Moving time: ${formatDuration(activity.movingTime)}, elapsed time: ${formatDuration(activity.elapsedTime)}`,
    `- Elevation gain: ${Math.round(activity.totalElevationGain)} m`,
    `- Recorded samples: ${activity.sampleCount}`,
  ];

  if (activity.analysis !== null) {
    lines.push(`- General coach analysis: ${activity.analysis.text.trim()}`);
  }
  if (input.comment !== undefined && input.comment !== null) {
    lines.push(`- Athlete comment: ${input.comment.trim()}`);
  }

  lines.push(
    "",
    "Match this activity to a planned session, then review how well it fit the program and what could have been done better.",
  );
  return lines.join("\n");
}
