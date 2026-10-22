import type {
  ActivitySummary,
  BlockPlan,
  SeasonPlan,
  WeekPlan,
} from "@killingit/shared";
import { formatDuration } from "./activityPrompt.js";

/** One interview question with the athlete's answer or explicit skip. */
export interface AthleteAnswerContext {
  prompt: string;
  answer: string | null;
  /** True when the athlete explicitly left this optional question blank. */
  skipped: boolean;
}

/** A recent activity plus the coach analysis generated for it, if any. */
export interface RecentActivityContext {
  summary: ActivitySummary;
  analysis: string | null;
}

/** A manually recorded activity. */
export interface ManualActivityContext {
  id: number;
  name: string;
  type: string;
  startDate: string;
  distance: number;
  movingTime: number;
  elapsedTime: number;
  totalElevationGain: number;
}

/** A comment the athlete added to an activity. */
export interface ActivityCommentContext {
  activityId: string;
  comment: string;
}

/** The complete context passed to the coach for a plan generation. */
export interface PlanContextInput {
  athleteAnswers: readonly AthleteAnswerContext[];
  recentActivities: readonly RecentActivityContext[];
  today: string;
  timezone?: string;
  manualActivities?: readonly ManualActivityContext[];
  activityComments?: readonly ActivityCommentContext[];
  weeklyNote?: string | null;
}

/** Renders the athlete's profile for a prompt. */
export function formatAthleteAnswers(
  entries: readonly AthleteAnswerContext[],
): string {
  if (entries.length === 0) {
    return "No interview answers were recorded.";
  }
  return entries.map(formatAthleteAnswer).join("\n");
}

/**
 * Renders recent training for a prompt, including each activity's coach
 * analysis. The empty case tells the model to plan conservatively.
 */
export function formatRecentActivities(
  entries: readonly RecentActivityContext[],
): string {
  if (entries.length === 0) {
    return "No recent activities were recorded. Assume the athlete is starting from the fitness and experience described in the profile, and build the plan conservatively.";
  }
  return entries.map(formatActivity).join("\n");
}

/**
 * The shared athlete/training context at the top of every plan prompt: today's
 * date, timezone, profile, recent activities with coach analyses, manually
 * recorded activities, activity comments, and the weekly note.
 */
export function formatPlanContext(input: PlanContextInput): string[] {
  const lines = [`Today's date: ${input.today}`];
  if (input.timezone !== undefined && input.timezone.trim() !== "") {
    lines.push(`Athlete timezone: ${input.timezone.trim()}`);
  }
  lines.push(
    "",
    "Athlete profile:",
    formatAthleteAnswers(input.athleteAnswers),
    "",
    "Recent activities (most recent first):",
    formatRecentActivities(input.recentActivities),
  );

  if (input.manualActivities && input.manualActivities.length > 0) {
    lines.push(
      "",
      "Manually recorded activities:",
      formatManualActivities(input.manualActivities),
    );
  }

  if (input.activityComments && input.activityComments.length > 0) {
    lines.push(
      "",
      "Activity comments:",
      formatActivityComments(input.activityComments),
    );
  }

  if (
    input.weeklyNote !== undefined &&
    input.weeklyNote !== null &&
    input.weeklyNote.trim() !== ""
  ) {
    lines.push("", "Weekly note:", input.weeklyNote.trim());
  }

  return lines;
}

/** Renders manually recorded activities for a prompt. */
export function formatManualActivities(
  entries: readonly ManualActivityContext[],
): string {
  return entries
    .map((entry, index) => {
      const details: string[] = [];
      if (entry.distance > 0) {
        details.push(`${(entry.distance / 1000).toFixed(2)} km`);
      }
      details.push(`${formatDuration(entry.movingTime)} moving`);
      if (entry.totalElevationGain > 0) {
        details.push(`${Math.round(entry.totalElevationGain)} m elevation`);
      }
      return `${index + 1}. ${entry.startDate.slice(0, 10)} — ${entry.type} — ${entry.name}: ${details.join(", ")}.`;
    })
    .join("\n");
}

/** Renders activity comments for a prompt. */
export function formatActivityComments(
  entries: readonly ActivityCommentContext[],
): string {
  return entries
    .map((entry) => `- Activity ${entry.activityId}: ${entry.comment.trim()}`)
    .join("\n");
}

/** Renders the season plan as an ordered block overview. */
export function formatSeasonPlan(plan: SeasonPlan): string {
  return [
    `Goal: ${plan.goal}`,
    `Dates: ${plan.startDate} → ${plan.endDate}`,
    `Rationale: ${plan.rationale}`,
    "Blocks:",
    ...plan.blocks.map(
      (block, index) =>
        `${index + 1}. ${block.name} (${block.startDate} → ${block.endDate}, ${block.weekCount} weeks): ${block.focus}`,
    ),
  ].join("\n");
}

/** Renders the detailed block plan and its weekly progression. */
export function formatBlockPlan(plan: BlockPlan): string {
  return [
    `Block: ${plan.name}`,
    `Focus: ${plan.focus}`,
    `Dates: ${plan.startDate} → ${plan.endDate}`,
    `Rationale: ${plan.rationale}`,
    "Weeks:",
    ...plan.weeks.map(
      (week) =>
        `- Week ${week.number} (from ${week.startDate}): ${week.focus}; target load: ${week.targetLoad}`,
    ),
  ].join("\n");
}

/** Renders the current week's seven sessions. */
export function formatWeekPlan(plan: WeekPlan): string {
  return [
    `Week starting ${plan.startDate} — focus: ${plan.focus}`,
    `Rationale: ${plan.rationale}`,
    "Sessions:",
    ...plan.sessions.map(
      (session) =>
        `- ${session.date} (${session.day}) [${session.status}]: ${session.title} [${session.type}, ${session.intensity}, ${session.durationMinutes} min] — ${session.description}`,
    ),
  ].join("\n");
}

function formatAthleteAnswer(entry: AthleteAnswerContext): string {
  const label = entry.prompt.trim();
  if (entry.answer !== null && entry.answer.trim() !== "") {
    return `- ${label}: ${entry.answer.trim()}`;
  }
  if (entry.skipped) {
    return `- ${label}: (skipped)`;
  }
  return `- ${label}: (not answered)`;
}

function formatActivity(entry: RecentActivityContext, index: number): string {
  const { summary, analysis } = entry;
  const details: string[] = [];
  if (summary.distance > 0) {
    details.push(`${(summary.distance / 1000).toFixed(2)} km`);
  }
  details.push(`${formatDuration(summary.movingTime)} moving`);
  if (summary.totalElevationGain > 0) {
    details.push(`${Math.round(summary.totalElevationGain)} m elevation`);
  }

  const lines = [
    `${index + 1}. ${summary.startDate.slice(0, 10)} — ${summary.type} — ${summary.name}: ${details.join(", ")}.`,
  ];
  if (analysis !== null && analysis.trim() !== "") {
    lines.push(`   Coach analysis: ${analysis.trim()}`);
  } else {
    lines.push("   Coach analysis: not available.");
  }
  return lines.join("\n");
}
