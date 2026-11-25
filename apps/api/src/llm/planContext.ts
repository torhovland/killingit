import {
  addDays,
  eventEndDate,
  startOfWeek,
  WEATHER_ICON_LABELS,
  type AthleteEvent,
  type DailyHealthPoint,
  type DailyWeather,
  type DietPlan,
  type MetricPoint,
  type ThresholdSummary,
  type TrainingLoad,
} from "@killingit/shared";
import type { DietPromptContext } from "../diet/summary.js";
import {
  formatActivityComments,
  formatManualActivities,
  formatRecentActivities,
  type ActivityCommentContext,
  type ManualActivityContext,
  type RecentActivityContext,
} from "./activityContext.js";
import {
  formatCalorieHistory,
  formatDietAdvice,
  formatDietContext,
  formatDietGoal,
  type CalorieTargetPoint,
} from "./dietContext.js";
import { formatDailyHealthContext } from "./healthContext.js";
import { formatTrainingLoad } from "./planLevelsContext.js";
import {
  formatAthleteEvents,
  formatAthleteProfile,
  formatBodyHistory,
  formatFtpContext,
  formatThresholdContext,
  latestAnswerDate,
  type AthleteAnswerContext,
  type BodyMetricHistory,
} from "./profileContext.js";
import { WEEKLY_NOTE_SCOPE_RULE } from "./promptRules.js";

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

/** The complete context passed to the coach for a plan generation. */
export interface PlanContextInput {
  athleteAnswers: readonly AthleteAnswerContext[];
  recentActivities: readonly RecentActivityContext[];
  today: string;
  timezone?: string | undefined;
  manualActivities?: readonly ManualActivityContext[] | undefined;
  activityComments?: readonly ActivityCommentContext[] | undefined;
  weeklyNote?: string | null | undefined;
  /** The Monday of the week the current note belongs to. */
  weeklyNoteWeekStartDate?: string | null | undefined;
  /** The coach's reply to the current week's note. */
  weeklyNoteReply?: string | null | undefined;
  /** Coach reviews of completed weeks and blocks, with athlete feedback. */
  periodReviews?: readonly PeriodReviewContext[] | undefined;
  /** Daily forecast for the athlete's location, when one has been set. */
  forecast?: readonly DailyWeather[] | undefined;
  /** The location label for the forecast, if the athlete named one. */
  locationName?: string | null | undefined;
  /** The FTP stated in the athlete's profile, when they gave one. */
  athleteFtpWatts?: number | null | undefined;
  /** The stored FTP threshold history, oldest first, including coach estimates. */
  ftpHistory?:
    readonly Pick<MetricPoint, "date" | "value" | "source">[] | undefined;
  /** Every threshold measure in effect today, across all sports. */
  thresholds?: readonly ThresholdSummary[] | undefined;
  /** The stored body weight and body-fat series, oldest first. */
  bodyHistory?: BodyMetricHistory | undefined;
  /** Stored daily sleep, HRV, readiness and related values for the prompt. */
  dailyHealth?: readonly DailyHealthPoint[] | undefined;
  /** The coach's current diet goal and weight-trend assessment. */
  dietGoal?: DietPlan | null | undefined;
  /** Whether the athlete has enabled diet advice. */
  dietAdvice?: boolean | undefined;
  /** The coach's earlier calorie targets for recent days, newest first. */
  calorieHistory?: readonly CalorieTargetPoint[] | undefined;
  /** The athlete's fitness snapshot for today, when one has been calculated. */
  currentForm?: TrainingLoad | null | undefined;
  /**
   * Dated goals and events the athlete stated, so the coach plans around a race,
   * a trip or a dated target instead of treating the week as empty.
   */
  events?: readonly AthleteEvent[] | undefined;
  /**
   * The meals from the last seven days and the completed-week nutrition
   * summaries, when the athlete wants diet advice and has logged food.
   */
  diet?: DietPromptContext | undefined;
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
  // Keep future events and past goals/races. A past goal is still part of the
  // season's story and explains the current load; a past trip or appointment
  // is only a historical constraint and would be noise.
  const listedEvents = (input.events ?? []).filter(
    (event) =>
      eventEndDate(event) >= input.today ||
      event.kind === "race" ||
      event.kind === "goal",
  );
  if (listedEvents.length > 0) {
    lines.push("", ...formatAthleteEvents(listedEvents, input.today));
  }
  if (input.athleteFtpWatts !== undefined && input.athleteFtpWatts !== null) {
    lines.push(
      "",
      `Athlete FTP: ${input.athleteFtpWatts} W (the latest FTP the athlete stated or the coach estimated as of today). Use this as the baseline for the week-by-week FTP estimate and for TSS.`,
    );
  }
  if (input.ftpHistory !== undefined && input.ftpHistory.length > 0) {
    lines.push("", ...formatFtpContext(input.ftpHistory));
  }
  if (input.thresholds !== undefined && input.thresholds.length > 0) {
    lines.push("", ...formatThresholdContext(input.thresholds));
  }
  if (input.bodyHistory !== undefined) {
    lines.push(...formatBodyHistory(input.bodyHistory));
  }
  if (input.dietGoal !== undefined && input.dietGoal !== null) {
    lines.push(...formatDietGoal(input.dietGoal));
  }
  if (input.dietAdvice !== undefined) {
    lines.push(...formatDietAdvice(input.dietAdvice));
  }
  if (input.calorieHistory !== undefined) {
    lines.push(...formatCalorieHistory(input.calorieHistory));
  }
  if (input.dailyHealth !== undefined) {
    lines.push(
      "",
      ...formatDailyHealthContext(input.dailyHealth, input.today, {
        today: input.today,
      }),
    );
  }
  if (input.currentForm !== undefined && input.currentForm !== null) {
    lines.push(
      "",
      `Current form (${input.today}): ${formatTrainingLoad(input.currentForm)}.`,
    );
  }
  if (input.diet !== undefined) {
    lines.push(...formatDietContext(input.diet, input.today));
  }
  lines.push(
    "",
    "Recent activities (most recent first).",
    formatRecentActivities(input.recentActivities, comments, input.timezone),
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
  lines.push(...formatWeeklyNote(input));

  if (input.periodReviews && input.periodReviews.length > 0) {
    lines.push(
      "",
      "Completed week and block reviews (most recent first):",
      formatPeriodReviews(input.periodReviews),
    );
  }

  if (input.forecast && input.forecast.length > 0) {
    lines.push(
      "",
      formatForecastHeader(input.locationName),
      formatWeatherForecast(input.forecast),
    );
  }

  return lines;
}

/**
 * The athlete's note for the current week with the coach's reply, and the rule
 * that scopes the note to its own week. A completed week's review can carry a
 * note even when the current week has none, so the scope rule covers both.
 */
function formatWeeklyNote(input: PlanContextInput): string[] {
  const note = input.weeklyNote?.trim() ?? "";
  const hasReviewWeeklyNote =
    input.periodReviews?.some(
      (review) => review.weeklyNote !== undefined && review.weeklyNote !== null,
    ) ?? false;
  const lines: string[] = [];
  if (note !== "" || hasReviewWeeklyNote) {
    lines.push("", WEEKLY_NOTE_SCOPE_RULE);
  }
  if (note === "") {
    return lines;
  }
  const weekStart = input.weeklyNoteWeekStartDate ?? startOfWeek(input.today);
  const weekEnd = addDays(weekStart, 6);
  lines.push(
    "",
    `Weekly note for the week starting ${weekStart} (${weekStart} → ${weekEnd}):`,
    note,
  );
  const reply = input.weeklyNoteReply?.trim() ?? "";
  if (reply !== "") {
    lines.push("Coach reply to the weekly note:", reply);
  }
  return lines;
}

/**
 * The forecast's opening line, naming the athlete's location only when they
 * named one so the header never reads "for " with an empty label.
 */
function formatForecastHeader(locationName: string | null | undefined): string {
  const location = locationName?.trim() ?? "";
  const where = location === "" ? "" : ` for ${location}`;
  return `Combined daily weather and daylight forecast${where} (the average of Open-Meteo and Yr.no). Temperatures are in °C; wind and gusts are in m/s; sunrise and sunset are local clock times.`;
}

/** Renders completed-period summaries and the athlete's feedback on them. */
function formatPeriodReviews(entries: readonly PeriodReviewContext[]): string {
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
