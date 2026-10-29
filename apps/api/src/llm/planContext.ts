import {
  WEATHER_ICON_LABELS,
  type ActivitySummary,
  type BikeWorkout,
  type BlockPlan,
  type CoachPlan,
  type DailyWeather,
  type DayPlan,
  type MetricPoint,
  type SeasonPlan,
  type WeekPlan,
  type WeekSession,
} from "@killingit/shared";
import { addDays, startOfWeek } from "../plans/dates.js";
import { formatDuration } from "./duration.js";
import {
  ACTIVITY_COMMENT_RULE,
  WEEKLY_NOTE_SCOPE_RULE,
} from "./promptRules.js";

/** One interview question with the athlete's answer or explicit skip. */
export interface AthleteAnswerContext {
  prompt: string;
  answer: string | null;
  /** True when the athlete explicitly left this optional question blank. */
  skipped: boolean;
  /** When this answer was last saved, used to date an FTP statement. */
  answeredAt?: Date | string | null;
}

/** A recent activity plus the coach analysis generated for it, if any. */
export interface RecentActivityContext {
  summary: ActivitySummary;
  analysis: string | null;
  /** How the activity fit the plan, generated after a full plan build. */
  programAnalysis?: string | null;
  /** The coach's latest reply to the athlete's comment on the activity. */
  coachReply?: string | null;
}

/** A coach review of a completed week or block, with athlete feedback. */
export interface PeriodReviewContext {
  kind: "week" | "block";
  title: string;
  startDate: string;
  endDate: string;
  summary: string;
  comment: string | null;
  reply: string | null;
  /** The note the athlete saved for that week and the coach's reply to it. */
  weeklyNote?: {
    note: string;
    reply: string | null;
  } | null;
  /** When the review or its athlete comment was last edited. */
  updatedAt?: string;
}

/** A manually recorded activity. */
export interface ManualActivityContext {
  id: number;
  startDate: string;
  details: string;
  /** The coach-estimated TSS for this entry, when it has one. */
  estimatedTss?: number | null;
  /** When the athlete last edited the entry; used to order FTP revisions. */
  updatedAt?: string;
}

/** A comment the athlete added to an activity. */
export interface ActivityCommentContext {
  activityId: string;
  comment: string;
  /** When the comment was last edited; used to order FTP revisions. */
  updatedAt?: string;
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
  /** The Monday of the week the current note belongs to. */
  weeklyNoteWeekStartDate?: string | null;
  /** The coach's reply to the current week's note. */
  weeklyNoteReply?: string | null;
  /** Coach reviews of completed weeks and blocks, with athlete feedback. */
  periodReviews?: readonly PeriodReviewContext[];
  /** Daily forecast for the athlete's location, when one has been set. */
  forecast?: readonly DailyWeather[];
  /** The location label for the forecast, if the athlete named one. */
  locationName?: string | null;
  /** The FTP stated in the athlete's profile, when they gave one. */
  athleteFtpWatts?: number | null;
  /** The stored FTP time series, oldest first, including coach estimates. */
  ftpHistory?: readonly Pick<MetricPoint, "date" | "value" | "source">[];
  /** The stored body weight and body-fat series, oldest first. */
  bodyHistory?: BodyMetricHistory | undefined;
}

/** The stored body-composition series handed to a prompt. */
export interface BodyMetricHistory {
  weight: readonly Pick<MetricPoint, "date" | "value" | "source">[];
  bodyFat: readonly Pick<MetricPoint, "date" | "value" | "source">[];
}

/** The most recent answer date, or null when no answer carries one. */
function latestAnswerDate(
  answers: readonly AthleteAnswerContext[],
): string | null {
  const dates = answers
    .map((entry) => entry.answeredAt)
    .filter(
      (value): value is Date | string => value !== undefined && value !== null,
    )
    .map((value) =>
      (value instanceof Date ? value.toISOString() : value).slice(0, 10),
    )
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  return dates.at(-1) ?? null;
}

/** Renders the athlete's profile with the date its answers were last saved. */
export function formatAthleteProfile(
  entries: readonly AthleteAnswerContext[],
  savedAt: string | null = latestAnswerDate(entries),
): string[] {
  return [
    savedAt === null
      ? "Athlete profile:"
      : `Athlete profile (answers last saved ${savedAt}):`,
    formatAthleteAnswers(entries),
  ];
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
 * Renders the stored FTP time series and its source meaning for any prompt
 * that estimates or compares power.
 */
export function formatFtpContext(
  points: readonly Pick<MetricPoint, "date" | "value" | "source">[],
): string[] {
  return [
    'FTP history (oldest first; "user" and "garmin" values are measurements, "coach" values are earlier estimates):',
    ...formatFtpHistory(points),
  ];
}

/**
 * Renders recent training for a prompt, including each activity's coach
 * analysis and the athlete's comment when there is one. The empty case tells
 * the model to plan conservatively.
 */
export function formatRecentActivities(
  entries: readonly RecentActivityContext[],
  comments: readonly ActivityCommentContext[] = [],
): string {
  if (entries.length === 0) {
    return "No recent activities were recorded. Assume the athlete is starting from the fitness and experience described in the profile, and build the plan conservatively.";
  }
  const commentsById = new Map(
    comments.map((entry) => [entry.activityId, entry.comment]),
  );
  return entries
    .map((entry, index) =>
      formatActivity(
        entry,
        index,
        commentsById.get(String(entry.summary.id)) ?? null,
      ),
    )
    .join("\n");
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
  const comments = input.activityComments ?? [];
  const listedActivityIds = new Set(
    input.recentActivities.map((entry) => String(entry.summary.id)),
  );
  const unlistedComments = comments.filter(
    (entry) => !listedActivityIds.has(entry.activityId),
  );

  // Dating the profile lets the coach place an undated statement (such as the
  // weight in the survey answers) on the day it was actually given.
  const profileDate = latestAnswerDate(input.athleteAnswers);
  lines.push("", ...formatAthleteProfile(input.athleteAnswers, profileDate));
  if (input.athleteFtpWatts !== undefined && input.athleteFtpWatts !== null) {
    lines.push(
      "",
      `Athlete FTP: ${input.athleteFtpWatts} W (the latest FTP the athlete stated or the coach estimated as of today). Use this as the baseline for the week-by-week FTP estimate and for TSS.`,
    );
  }
  if (input.ftpHistory !== undefined && input.ftpHistory.length > 0) {
    lines.push("", ...formatFtpContext(input.ftpHistory));
  }
  if (input.bodyHistory !== undefined) {
    lines.push(...formatBodyHistory(input.bodyHistory));
  }
  lines.push(
    "",
    `Recent activities (most recent first). ${ACTIVITY_COMMENT_RULE}`,
    formatRecentActivities(input.recentActivities, comments),
  );
  if (input.manualActivities && input.manualActivities.length > 0) {
    lines.push(
      "",
      "Manually recorded activities:",
      formatManualActivities(input.manualActivities),
    );
  }
  if (unlistedComments.length > 0) {
    lines.push(
      "",
      "Activity comments:",
      "Each comment describes the activity with the matching ID. It is not a separate activity or extra training.",
      formatActivityComments(unlistedComments),
    );
  }
  const hasCurrentWeeklyNote =
    input.weeklyNote !== undefined &&
    input.weeklyNote !== null &&
    input.weeklyNote.trim() !== "";
  const hasReviewWeeklyNote =
    input.periodReviews?.some(
      (review) => review.weeklyNote !== undefined && review.weeklyNote !== null,
    ) ?? false;
  if (hasCurrentWeeklyNote || hasReviewWeeklyNote) {
    lines.push("", WEEKLY_NOTE_SCOPE_RULE);
  }
  if (
    hasCurrentWeeklyNote &&
    input.weeklyNote !== null &&
    input.weeklyNote !== undefined
  ) {
    const weekStart = input.weeklyNoteWeekStartDate ?? startOfWeek(input.today);
    const weekEnd = addDays(weekStart, 6);
    lines.push(
      "",
      `Weekly note for the week starting ${weekStart} (${weekStart} → ${weekEnd}):`,
      input.weeklyNote.trim(),
    );
    if (
      input.weeklyNoteReply !== undefined &&
      input.weeklyNoteReply !== null &&
      input.weeklyNoteReply.trim() !== ""
    ) {
      lines.push(
        "Coach reply to the weekly note:",
        input.weeklyNoteReply.trim(),
      );
    }
  }

  if (input.periodReviews && input.periodReviews.length > 0) {
    lines.push(
      "",
      "Completed week and block reviews (most recent first):",
      formatPeriodReviews(input.periodReviews),
    );
  }

  if (input.forecast && input.forecast.length > 0) {
    const where =
      input.locationName !== undefined &&
      input.locationName !== null &&
      input.locationName.trim() !== ""
        ? ` for ${input.locationName.trim()}`
        : "";
    lines.push(
      "",
      `Combined daily weather and daylight forecast${where} (the average of Open-Meteo and Yr.no). Temperatures are in °C; wind and gusts are in m/s; sunrise and sunset are local clock times.`,
      formatWeatherForecast(input.forecast),
    );
  }

  return lines;
}

/** Renders completed-period summaries and the athlete's feedback on them. */
export function formatPeriodReviews(
  entries: readonly PeriodReviewContext[],
): string {
  return entries
    .map((entry) => {
      const lines = [
        `- Completed ${entry.kind}: ${entry.title} (${entry.startDate} → ${entry.endDate})`,
        `  Coach summary: ${entry.summary.trim()}`,
      ];
      if (entry.weeklyNote !== undefined && entry.weeklyNote !== null) {
        lines.push(
          `  Weekly note for the week starting ${entry.startDate} (${entry.startDate} → ${entry.endDate}): ${entry.weeklyNote.note.trim()}`,
        );
        if (
          entry.weeklyNote.reply !== null &&
          entry.weeklyNote.reply.trim() !== ""
        ) {
          lines.push(
            `  Coach reply to the weekly note: ${entry.weeklyNote.reply.trim()}`,
          );
        }
      }
      if (entry.comment !== null && entry.comment.trim() !== "") {
        lines.push(`  Athlete comment: ${entry.comment.trim()}`);
      }
      if (entry.reply !== null && entry.reply.trim() !== "") {
        lines.push(`  Coach reply: ${entry.reply.trim()}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

/** Renders the daily forecast, including local daylight times, for a prompt. */
export function formatWeatherForecast(days: readonly DailyWeather[]): string {
  return days
    .map((day) => {
      const daylight = [
        day.sunrise != null ? `sunrise ${day.sunrise}` : null,
        day.sunset != null ? `sunset ${day.sunset}` : null,
      ].filter((entry): entry is string => entry !== null);
      const daylightText =
        daylight.length === 0 ? "" : `, ${daylight.join(", ")}`;
      return `- ${day.date}: ${WEATHER_ICON_LABELS[day.icon]} (${day.icon}), ${Math.round(day.temperatureMinC)}–${Math.round(day.temperatureMaxC)} °C, wind up to ${Math.round(day.windMaxMs)} m/s, gusts up to ${Math.round(day.gustMaxMs)} m/s, ${day.precipitationMm.toFixed(1)} mm precipitation${daylightText}`;
    })
    .join("\n");
}

/** Renders manually recorded activities for a prompt. */
export function formatManualActivities(
  entries: readonly ManualActivityContext[],
): string {
  return entries
    .map((entry, index) => {
      const tss =
        entry.estimatedTss !== undefined && entry.estimatedTss !== null
          ? ` (estimated TSS ${entry.estimatedTss})`
          : "";
      return `${index + 1}. ${entry.startDate} — ${entry.details}${tss}`;
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
    `Dates: ${plan.startDate} → ${plan.endDate}${plan.estimatedFtpWatts != null ? ` — estimated FTP ${plan.estimatedFtpWatts} W` : ""}`,
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
    `Dates: ${plan.startDate} → ${plan.endDate}${plan.estimatedFtpWatts != null ? ` — estimated FTP ${plan.estimatedFtpWatts} W` : ""}`,
    `Rationale: ${plan.rationale}`,
    "Weeks:",
    ...plan.weeks.map(
      (week) =>
        `- Week ${week.number} (from ${week.startDate}): ${week.focus}; target load: ${week.targetLoad}${week.estimatedFtpWatts != null ? `; estimated FTP ${week.estimatedFtpWatts} W` : ""}`,
    ),
  ].join("\n");
}

/** Renders the current week's seven sessions. */
export function formatWeekPlan(plan: WeekPlan): string {
  return [
    `Week starting ${plan.startDate} — focus: ${plan.focus}${plan.estimatedFtpWatts != null ? ` — estimated FTP ${plan.estimatedFtpWatts} W` : ""}`,
    `Rationale: ${plan.rationale}`,
    "Sessions:",
    ...plan.sessions.map((session) => {
      const tss =
        session.estimatedTss !== undefined
          ? `; estimated TSS ${session.estimatedTss}`
          : "";
      return `- ${session.date} (${session.day}) [${session.status}]: ${formatPlannedSession(session)}${tss}`;
    }),
  ].join("\n");
}

/**
 * Renders one concrete day plan for a prompt. The week plan only carries the
 * session summary; a day plan also carries alternatives and the optionality
 * guidance, so the update prompt can see the full current day.
 */
export function formatDayPlan(plan: DayPlan): string {
  const lines = [
    `Date: ${plan.date}`,
    `Title: ${plan.title}`,
    `Type: ${plan.type}; intensity: ${plan.intensity}; duration: ${plan.durationMinutes} min; status: ${plan.status}`,
    `Description: ${plan.description}`,
    `Rationale: ${plan.rationale}`,
  ];
  if (plan.alternatives !== undefined && plan.alternatives.length > 0) {
    lines.push(`Alternatives: ${plan.alternatives.join("; ")}`);
  }
  if (plan.optional) {
    lines.push(
      `Optional: true${plan.optionalRationale !== undefined ? ` — ${plan.optionalRationale}` : ""}`,
    );
  }
  if (plan.outdoor !== undefined) {
    lines.push(`Outdoor: ${plan.outdoor}`);
  }
  if (plan.canBeOutdoor !== undefined) {
    lines.push(`Can be outdoor: ${plan.canBeOutdoor}`);
  }
  if (plan.bikeWorkout != null) {
    lines.push(`Bike workout: ${formatBikeWorkout(plan.bikeWorkout)}`);
  }
  if (plan.estimatedTss !== undefined) {
    lines.push(`Estimated TSS: ${plan.estimatedTss}`);
  }
  return lines.join("\n");
}

/**
 * The season and current block, rendered the same way for every prompt that
 * starts from the athlete's current plan.
 */
export function formatSeasonAndBlock(
  season: SeasonPlan,
  block: BlockPlan,
): string[] {
  return [
    "Current season plan:",
    formatSeasonPlan(season),
    "",
    "Current block plan:",
    formatBlockPlan(block),
  ];
}

/**
 * The season, current block and current week, rendered the same way for every
 * prompt that starts from the athlete's current plan.
 */
export function formatPlanLevels(
  plan: Pick<CoachPlan, "season" | "block" | "week">,
): string[] {
  return [
    ...formatSeasonAndBlock(plan.season, plan.block),
    "",
    "Current week plan:",
    formatWeekPlan(plan.week),
  ];
}

/**
 * Renders the one-line session summary shared by the coach reply and the
 * program review, including a bike workout's power targets when it has one.
 */
export function formatPlannedSession(session: WeekSession): string {
  const bikeWorkout =
    session.bikeWorkout != null
      ? `; ${formatBikeWorkout(session.bikeWorkout)}`
      : "";
  return `${session.title} [${session.type}, ${session.intensity}, ${session.durationMinutes} min] — ${session.description}${bikeWorkout}`;
}

/** Renders a structured bike workout's power targets for a generation prompt. */
function formatBikeWorkout(workout: BikeWorkout): string {
  const intervals = workout.intervals
    .map(
      (interval) =>
        `${interval.durationSeconds}s at ${interval.powerPercent}% FTP`,
    )
    .join(", ");
  return `power targets at FTP ${workout.ftpWatts} W: ${intervals}`;
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

/** The most recent FTP points, oldest first, as a compact prompt table. */
function formatFtpHistory(
  points: readonly Pick<MetricPoint, "date" | "value" | "source">[],
): string[] {
  return points
    .slice(-60)
    .map(
      (point) =>
        `- ${point.date}: ${Math.round(point.value)} W (${point.source})`,
    );
}

/**
 * The stored body weight and body-fat series, oldest first. Both lists share
 * the FTP history's source meaning; coach values are only earlier estimates.
 */
export function formatBodyHistory(history: BodyMetricHistory): string[] {
  const lines: string[] = [];
  if (history.weight.length > 0) {
    lines.push(
      "",
      'Body weight history (oldest first; "user" and "garmin" values are measurements, "coach" values are earlier estimates):',
      ...recentMetricLines(history.weight, (value) => `${value.toFixed(1)} kg`),
    );
  }
  if (history.bodyFat.length > 0) {
    lines.push(
      "",
      'Body fat history (oldest first; "user" and "garmin" values are measurements, "coach" values are earlier estimates):',
      ...recentMetricLines(history.bodyFat, (value) => `${value.toFixed(1)} %`),
    );
  }
  return lines;
}

function recentMetricLines(
  points: readonly Pick<MetricPoint, "date" | "value" | "source">[],
  format: (value: number) => string,
): string[] {
  return points
    .slice(-60)
    .map(
      (point) => `- ${point.date}: ${format(point.value)} (${point.source})`,
    );
}

/**
 * Renders the recorded activity summary shared by the activity review and the
 * program review, so both prompts describe the same numbers the same way.
 */
export function formatActivitySummary(
  activity: Pick<
    ActivitySummary,
    | "name"
    | "type"
    | "startDate"
    | "distance"
    | "movingTime"
    | "elapsedTime"
    | "totalElevationGain"
  >,
  sampleCount: number,
): string[] {
  return [
    `- Name: ${activity.name}`,
    `- Type (recorded by the device; may be wrong): ${activity.type}`,
    `- Started: ${activity.startDate}`,
    `- Distance: ${(activity.distance / 1000).toFixed(2)} km`,
    `- Moving time: ${formatDuration(activity.movingTime)}, elapsed time: ${formatDuration(activity.elapsedTime)}`,
    `- Elevation gain: ${Math.round(activity.totalElevationGain)} m`,
    `- Recorded samples: ${sampleCount}`,
  ];
}

function formatActivity(
  entry: RecentActivityContext,
  index: number,
  comment: string | null,
): string {
  const { summary, analysis } = entry;
  const details: string[] = [];
  if (summary.distance > 0) {
    details.push(`${(summary.distance / 1000).toFixed(2)} km`);
  }
  details.push(`${formatDuration(summary.movingTime)} moving`);
  if (summary.totalElevationGain > 0) {
    details.push(`${Math.round(summary.totalElevationGain)} m elevation`);
  }
  if (summary.normalizedPower != null) {
    details.push(
      `NP ${Math.round(summary.normalizedPower)} W${summary.averagePower != null ? ` (average ${Math.round(summary.averagePower)} W)` : ""}`,
    );
  }

  const lines = [
    `${index + 1}. ${summary.startDate.slice(0, 10)} — ${summary.type} — ${summary.name}: ${details.join(", ")}.`,
  ];
  if (analysis !== null && analysis.trim() !== "") {
    lines.push(`   Coach analysis: ${analysis.trim()}`);
  } else {
    lines.push("   Coach analysis: not available.");
  }
  if (
    entry.programAnalysis !== undefined &&
    entry.programAnalysis !== null &&
    entry.programAnalysis.trim() !== ""
  ) {
    lines.push(
      `   Coach review against the plan: ${entry.programAnalysis.trim()}`,
    );
  }
  if (comment !== null && comment.trim() !== "") {
    lines.push(
      `   Athlete comment about this same activity (not an additional session): ${comment.trim()}`,
    );
  }
  if (
    entry.coachReply !== undefined &&
    entry.coachReply !== null &&
    entry.coachReply.trim() !== ""
  ) {
    lines.push(`   Coach reply to that comment: ${entry.coachReply.trim()}`);
  }
  return lines.join("\n");
}
