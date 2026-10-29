import {
  WEATHER_ICON_LABELS,
  type ActivitySummary,
  type BikeWorkout,
  type BlockPlan,
  type DailyWeather,
  type DayPlan,
  type MetricPoint,
  type SeasonPlan,
  type WeekPlan,
} from "@killingit/shared";
import { formatDuration } from "./duration.js";

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

/**
 * Shared rule for every prompt that receives activity comments: a comment is
 * the athlete's description of an activity that is already listed, not another
 * activity.
 */
export const ACTIVITY_COMMENT_RULE =
  "A comment on an activity describes that same activity. It is not an additional activity and must never be added on top of the activity's recorded time or treated as extra training.";

/**
 * Shared rule for the day the athlete is about to train. A session must earn
 * its place: the coach states what it builds toward the plan's goal and what
 * skipping costs, and treats a session it cannot justify as a reason to revise
 * the week instead of hiding it behind an "optional" label.
 */
export const SESSION_PURPOSE_RULES = `For today's and tomorrow's workouts, explain the session's purpose against the plan's goal. In "optionalRationale", name the concrete adaptation or fitness quality the session builds toward the season goal, the block's focus, and the week's target load, and state what the athlete loses toward that goal if they skip it. Be specific and motivating (for example, "the aerobic durability that carries you through the last 10 km of the marathon") rather than generic encouragement.

Set "optional" to true only when the cost of skipping is genuinely small, and explain in "optionalRationale" why that cost is acceptable today (for example, a short recovery run at the end of a hard week). Never use "optional" as a label for a workout with no clear purpose.

Before returning, apply the same test to every workout in the week: if you cannot state a concrete loss for skipping a planned session, that session is filler. Revise the week so every workout serves the goal, or replace the session with rest, and update today's plan to match. The week must be the best plan you can make for this athlete's goal, not a template to fill.

If today or tomorrow is a rest day, explain in "rationale" why rest is the best choice today; no optionality assessment is needed.`;

/**
 * Shared instruction for the level of detail in a week plan. A week is a
 * shape, not seven finished workouts: only today and tomorrow need a concrete
 * prescription, because the daily update will detail each later day when it
 * arrives.
 */
export const WEEK_OUTLINE_RULES = `Treat the week as an outline, not seven finished workouts. Fully detail only the sessions the request says need detail: a concrete description, and for an indoor bike workout with power targets a "bikeWorkout". Keep every other future day as a short outline: the session type, a brief title naming the kind of session, a one-sentence description of its intent, an approximate duration and intensity, and an "estimatedTss". Do not prescribe detailed intervals, repetitions, paces, or power targets for outline days, and set "bikeWorkout" to null there; the daily update will turn an outline into a concrete workout when that day arrives. The outline must still show the week's shape: which days are long, hard, easy, or rest. Set the week's "estimatedFtpWatts" from the athlete's profile and the plan's progression, and estimate each outline day's "estimatedTss" against it.`;

/**
 * Shared instruction for the body-composition points the coach reports. The
 * app stores them in the same daily time series as Garmin's weigh-ins, so the
 * athlete sees a weight and body-fat trend on the Fitness page even before
 * their scale is connected.
 */
export const BODY_METRIC_RULES = `When the profile, a weekly note, an activity comment, or another part of the input states the athlete's body weight or body-fat percentage, report it in "bodyMetrics" as { "date": "YYYY-MM-DD", "weightKg": number, "bodyFatPercent": number }. Give body weight in kilograms and body fat as a percentage of body weight; convert a stated weight in pounds. Use the date the statement refers to. For a number in the profile that names no date, use the date the profile was last saved; for anything added more recently, use today's date. Set a value the input does not give to null, and return an empty "bodyMetrics" array when the input says nothing about either number. Report only numbers that appear in the input: never guess a weight, a body-fat percentage, or a future trend, and never turn a goal into a measurement. The stored history tells you what is already known; do not repeat a value for the same date.`;

/** The complete context passed to the coach for a plan generation. */
export interface PlanContextInput {
  athleteAnswers: readonly AthleteAnswerContext[];
  recentActivities: readonly RecentActivityContext[];
  today: string;
  timezone?: string;
  manualActivities?: readonly ManualActivityContext[];
  activityComments?: readonly ActivityCommentContext[];
  weeklyNote?: string | null;
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
  lines.push(
    "",
    profileDate === null
      ? "Athlete profile:"
      : `Athlete profile (answers last saved ${profileDate}):`,
    formatAthleteAnswers(input.athleteAnswers),
  );
  if (input.athleteFtpWatts !== undefined && input.athleteFtpWatts !== null) {
    lines.push(
      "",
      `Athlete FTP: ${input.athleteFtpWatts} W (the latest FTP the athlete stated or the coach estimated as of today). Use this as the baseline for the week-by-week FTP estimate and for TSS.`,
    );
  }
  if (input.ftpHistory !== undefined && input.ftpHistory.length > 0) {
    lines.push(
      "",
      'FTP history (oldest first; "user" values are measurements the athlete stated, "garmin" values are synced measurements, and "coach" values are earlier estimates):',
      ...formatFtpHistory(input.ftpHistory),
    );
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

  if (
    input.weeklyNote !== undefined &&
    input.weeklyNote !== null &&
    input.weeklyNote.trim() !== ""
  ) {
    lines.push("", "Weekly note:", input.weeklyNote.trim());
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
      const bikeWorkout =
        session.bikeWorkout != null
          ? `; ${formatBikeWorkout(session.bikeWorkout)}`
          : "";
      const tss =
        session.estimatedTss !== undefined
          ? `; estimated TSS ${session.estimatedTss}`
          : "";
      return `- ${session.date} (${session.day}) [${session.status}]: ${session.title} [${session.type}, ${session.intensity}, ${session.durationMinutes} min] — ${session.description}${bikeWorkout}${tss}`;
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
