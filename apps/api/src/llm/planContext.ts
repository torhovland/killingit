import {
  FORM_INTERPRETATION_LABELS,
  WEATHER_ICON_LABELS,
  activityAverageSpeed,
  activityUsesPace,
  cadenceUnit,
  eventEndDate,
  formatActivityPaceOrSpeed,
  formatThresholdValue,
  hasLapStructure,
  interpretTrainingStressBalance,
  isDefaultDietGoal,
  type ActivityLap,
  type ActivitySummary,
  type AthleteEvent,
  type BikeWorkout,
  type BlockPlan,
  type CoachPlan,
  type DailyHealthPoint,
  type DailyWeather,
  type DayPlan,
  type DietPlan,
  type DietProgress,
  type MetricPoint,
  type SeasonPlan,
  type StrengthSet,
  type ThresholdSummary,
  type TrainingLoad,
  type WeekPlan,
  type WeekSession,
} from "@killingit/shared";
import type {
  DietMealContext,
  DietPromptContext,
  DietWeekSummary,
} from "../diet/summary.js";
import { addDays, startOfWeek } from "../plans/dates.js";
import { impliedGoalBodyFatPercent } from "../plans/dietProgress.js";
import { formatDuration } from "./duration.js";
import { formatDailyHealthContext } from "./healthContext.js";
import { WEEKLY_NOTE_SCOPE_RULE } from "./promptRules.js";

/** Most laps listed individually; the rest are reported as a count. */
const MAX_PROMPT_LAPS = 40;

/** One interview question with the athlete's answer or explicit skip. */
export interface AthleteAnswerContext {
  prompt: string;
  answer: string | null;
  /** True when the athlete explicitly left this optional question blank. */
  skipped: boolean;
  /** When this answer was last saved, used to date an FTP statement. */
  answeredAt?: Date | string | null;
}

/** One survey answer the coach has not incorporated into the plan yet. */
export interface CoachingSurveyAdjustmentContext {
  question: string;
  previousQuestion: string | null;
  answer: string | null;
  previousAnswer: string | null;
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
  /** Every threshold measure in effect today, across all sports. */
  thresholds?: readonly ThresholdSummary[];
  /** The stored body weight and body-fat series, oldest first. */
  bodyHistory?: BodyMetricHistory | undefined;
  /** Stored daily sleep, HRV, readiness and related values for the prompt. */
  dailyHealth?: readonly DailyHealthPoint[];
  /** The coach's current diet goal and weight-trend assessment. */
  dietGoal?: DietPlan | null;
  /** Whether the athlete has enabled diet advice. */
  dietAdvice?: boolean;
  /** The coach's earlier calorie targets for recent days, newest first. */
  calorieHistory?: readonly CalorieTargetPoint[];
  /** The athlete's fitness snapshot for today, when one has been calculated. */
  currentForm?: TrainingLoad | null;
  /**
   * Dated goals and events the athlete stated, so the coach plans around a race,
   * a trip or a dated target instead of treating the week as empty.
   */
  events?: readonly AthleteEvent[];
  /**
   * The meals from the last seven days and the completed-week nutrition
   * summaries, when the athlete wants diet advice and has logged food.
   */
  diet?: DietPromptContext;
}

/** The stored body-composition series handed to a prompt. */
export interface BodyMetricHistory {
  weight: readonly Pick<MetricPoint, "date" | "value" | "source">[];
  bodyFat: readonly Pick<MetricPoint, "date" | "value" | "source">[];
}

/** One earlier calorie requirement the coach set for a day. */
export interface CalorieTargetPoint {
  date: string;
  caloriesKcal: number;
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
 * Renders survey answers the athlete changed after the plan was generated,
 * including the earlier wording and answer so the coach can see what changed.
 */
export function formatCoachingSurveyAdjustments(
  adjustments: readonly CoachingSurveyAdjustmentContext[],
): string[] {
  if (adjustments.length === 0) {
    return [];
  }
  return [
    "Coaching survey adjustments since the plan was generated (most recent last):",
    ...adjustments.flatMap((adjustment) => {
      const lines = [`- Question: ${adjustment.question.trim()}`];
      if (
        adjustment.previousQuestion !== null &&
        adjustment.previousQuestion.trim() !== adjustment.question.trim()
      ) {
        lines.push(
          `  Previous question: ${adjustment.previousQuestion.trim()}`,
        );
      }
      if (adjustment.previousQuestion !== null) {
        lines.push(
          `  Previous answer: ${formatAdjustmentAnswer(adjustment.previousAnswer)}`,
        );
      }
      lines.push(`  New answer: ${formatAdjustmentAnswer(adjustment.answer)}`);
      return lines;
    }),
  ];
}

/**
 * Renders the dated goals and events the athlete stated. The coach plans around
 * these dates, so the list sits with the profile at the top of the context.
 */
export function formatAthleteEvents(events: readonly AthleteEvent[]): string[] {
  if (events.length === 0) {
    return [];
  }
  return [
    "Dated goals and events the athlete stated:",
    ...events.map((event) => {
      const dates =
        event.endDate === null || event.endDate === event.startDate
          ? event.startDate
          : `${event.startDate} → ${event.endDate}`;
      return `- ${dates} (${event.kind}): ${event.title}`;
    }),
  ];
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
 * Renders every threshold measure currently in effect, one line per sport and
 * measure, so a prompt sees cycling FTP and running threshold pace alike.
 */
export function formatThresholdContext(
  thresholds: readonly ThresholdSummary[],
): string[] {
  return [
    "Athlete thresholds in effect today:",
    ...thresholds.map(
      (entry) =>
        `- ${entry.sport} / ${entry.label}: ${formatThresholdValue(entry.value, entry.unit, entry.kind)} (${entry.source}, ${entry.date})`,
    ),
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
  const upcomingEvents = (input.events ?? []).filter(
    (event) => eventEndDate(event) >= input.today,
  );
  if (upcomingEvents.length > 0) {
    lines.push("", ...formatAthleteEvents(upcomingEvents));
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
    lines.push(
      "",
      `Diet goal: ${input.dietGoal.goal}`,
      `Diet goal status: ${
        (input.dietGoal.goalProvided ?? !isDefaultDietGoal(input.dietGoal.goal))
          ? "stated by the athlete"
          : "default because the athlete stated none"
      }.`,
    );
    const goalTarget = formatDietGoalTarget(input.dietGoal);
    if (goalTarget !== null) {
      lines.push(`Diet goal target: ${goalTarget}.`);
    }
    lines.push(`Diet assessment: ${input.dietGoal.assessment}`);
  }
  if (input.dietAdvice !== undefined) {
    lines.push(
      "",
      `Diet advice: ${input.dietAdvice ? "enabled" : "disabled"}.`,
    );
  }
  if (input.calorieHistory !== undefined && input.calorieHistory.length > 0) {
    lines.push(
      "",
      "Earlier daily calorie targets (newest first; your own estimates, shown so you can judge the weight trend):",
      ...input.calorieHistory.map(
        (point) => `- ${point.date}: ${Math.round(point.caloriesKcal)} kcal`,
      ),
    );
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

/**
 * Renders the food log for a prompt: the individually listed meals of the last
 * seven days and the aggregate of each completed week. Empty when the athlete
 * has logged nothing, and omitted entirely when diet advice is off.
 */
export function formatDietContext(
  diet: DietPromptContext,
  today: string,
): string[] {
  if (diet.meals.length === 0 && diet.weeks.length === 0) {
    return [];
  }
  const lines = [
    "",
    `Food log (times are the athlete's local clock; nutrition numbers are your earlier estimates, not measurements):`,
  ];
  if (diet.meals.length === 0) {
    lines.push("No meals were logged in the last 7 days.");
  } else {
    lines.push(
      "Recent meals (last 7 days, most recent first):",
      ...diet.meals.map(formatDietMeal),
    );
  }
  if (diet.weeks.length > 0) {
    lines.push(
      `Weekly nutrition summary for completed weeks (most recent first, up to one year from ${today}):`,
      ...diet.weeks.map(formatDietWeek),
    );
  }
  return lines;
}

function formatDietMeal(meal: DietMealContext): string {
  const athlete =
    meal.description === null || meal.description.trim() === ""
      ? "Athlete: (no description; photo only)"
      : `Athlete: "${oneLine(meal.description)}"`;
  if (meal.analysis === null) {
    const why =
      meal.analysisError !== null && meal.analysisError.trim() !== ""
        ? ` (${oneLine(meal.analysisError)})`
        : "";
    return `- ${meal.eatenDate} ${meal.eatenTime} — ${athlete} — Coach analysis unavailable${why}.`;
  }
  const analysis = meal.analysis;
  return `- ${meal.eatenDate} ${meal.eatenTime} — ${athlete} — Coach: ${oneLine(analysis.meal)} — ${Math.round(analysis.carbsGrams)} g carbs, ${Math.round(analysis.proteinGrams)} g protein, ${Math.round(analysis.fatGrams)} g fat, ${Math.round(analysis.caloriesKcal)} kcal. Diet fit: ${oneLine(analysis.dietFit)}`;
}

/** Collapses a possibly multi-line field to one prompt line. */
function oneLine(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function formatDietWeek(week: DietWeekSummary): string {
  const head = `- Week starting ${week.weekStart}: ${week.meals} ${week.meals === 1 ? "meal" : "meals"} over ${week.daysLogged} ${week.daysLogged === 1 ? "day" : "days"}`;
  if (week.nutritionDays === 0) {
    return `${head}; no estimated nutrition available.`;
  }
  return `${head}; averaged over ${week.nutritionDays} logged ${week.nutritionDays === 1 ? "day" : "days"}: ${week.carbsGramsPerDay ?? 0} g carbs, ${week.proteinGramsPerDay ?? 0} g protein, ${week.fatGramsPerDay ?? 0} g fat, ${week.caloriesKcalPerDay ?? 0} kcal per day.`;
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
  const lines = [
    `Goal: ${plan.goal}`,
    `Dates: ${plan.startDate} → ${plan.endDate}${plan.estimatedFtpWatts != null ? ` — estimated FTP ${plan.estimatedFtpWatts} W` : ""}`,
  ];
  if (plan.dietProgress != null) {
    lines.push(
      `Diet progress by the end of the season: ${formatDietProgress(plan.dietProgress)}`,
    );
  }
  lines.push(
    `Rationale: ${plan.rationale}`,
    "Blocks:",
    ...plan.blocks.flatMap((block, index) => [
      `${index + 1}. ${block.name} (${block.startDate} → ${block.endDate}, ${block.weekCount} weeks): ${block.focus}`,
      ...(block.dietProgress != null
        ? [
            `   Diet progress by the end of this block: ${formatDietProgress(block.dietProgress)}`,
          ]
        : []),
    ]),
  );
  return lines.join("\n");
}

/** Renders the detailed block plan and its weekly progression. */
export function formatBlockPlan(plan: BlockPlan): string {
  const lines = [
    `Block: ${plan.name}`,
    `Focus: ${plan.focus}`,
    `Dates: ${plan.startDate} → ${plan.endDate}${plan.estimatedFtpWatts != null ? ` — estimated FTP ${plan.estimatedFtpWatts} W` : ""}`,
  ];
  if (plan.dietProgress != null) {
    lines.push(
      `Diet progress by the end of the block: ${formatDietProgress(plan.dietProgress)}`,
    );
  }
  lines.push(
    `Rationale: ${plan.rationale}`,
    "Weeks:",
    ...plan.weeks.map((week) => {
      const progress =
        week.dietProgress != null
          ? `; diet progress by the end of the week: ${formatDietProgress(week.dietProgress)}`
          : "";
      return `- Week ${week.number} (from ${week.startDate}): ${week.focus}; target load: ${week.targetLoad}${week.estimatedFtpWatts != null ? `; estimated FTP ${week.estimatedFtpWatts} W` : ""}${progress}`;
    }),
  );
  return lines.join("\n");
}

/** One target line for a plan period. Assumes the progress object exists. */
function formatDietProgress(progress: DietProgress): string {
  const targets: string[] = [];
  if (progress.targetWeightKg !== null) {
    targets.push(`${progress.targetWeightKg.toFixed(1)} kg`);
  }
  if (progress.targetBodyFatPercent !== null) {
    targets.push(`${progress.targetBodyFatPercent.toFixed(1)} % body fat`);
  }
  const targetText =
    targets.length > 0 ? targets.join(" and ") : "no numeric target";
  return `${targetText}. ${progress.note.trim()}`;
}

/** The numeric goal the athlete stated, in one prompt line. */
function formatDietGoalTarget(diet: DietPlan): string | null {
  const parts: string[] = [];
  if (diet.goalWeightKg != null) {
    parts.push(`${diet.goalWeightKg.toFixed(1)} kg`);
  }
  const goalBodyFatPercent =
    diet.goalBodyFatPercent ?? impliedGoalBodyFatPercent(diet.goal);
  if (goalBodyFatPercent !== null) {
    parts.push(`${goalBodyFatPercent.toFixed(1)} % body fat`);
  }
  if (diet.goalDate != null) {
    parts.push(`by ${diet.goalDate}`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * One compact training-load snapshot. It uses the same labels as the app's
 * views, so the prompt and the UI cannot describe the same TSB differently.
 */
function formatTrainingLoad(load: TrainingLoad): string {
  const label =
    FORM_INTERPRETATION_LABELS[interpretTrainingStressBalance(load.tsb)];
  return `ATL ${load.atl} · CTL ${load.ctl} · TSB ${load.tsb} · ${label}`;
}

/** Renders the current week's seven sessions. */
export function formatWeekPlan(plan: WeekPlan): string {
  const lines = [
    `Week starting ${plan.startDate} — focus: ${plan.focus}${plan.estimatedFtpWatts != null ? ` — estimated FTP ${plan.estimatedFtpWatts} W` : ""}`,
  ];
  if (plan.dietProgress != null) {
    lines.push(
      `Diet progress by the end of the week: ${formatDietProgress(plan.dietProgress)}`,
    );
  }
  lines.push(
    `Rationale: ${plan.rationale}`,
    "Sessions:",
    ...plan.sessions.map((session) => {
      const tss =
        session.estimatedTss !== undefined
          ? `; estimated TSS ${session.estimatedTss}`
          : "";
      const load =
        session.trainingLoad != null
          ? `; ${formatTrainingLoad(session.trainingLoad)}`
          : "";
      return `- ${session.date} (${session.day}) [${session.status}]: ${formatPlannedSession(session)}${tss}${load}`;
    }),
  );
  return lines.join("\n");
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
  if (plan.trainingLoad !== undefined && plan.trainingLoad !== null) {
    lines.push(`Projected load: ${formatTrainingLoad(plan.trainingLoad)}`);
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

function formatAdjustmentAnswer(answer: string | null): string {
  return answer !== null && answer.trim() !== "" ? answer.trim() : "(skipped)";
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
export function formatBodyHistory(
  history: BodyMetricHistory,
  throughDate?: string,
): string[] {
  const weight =
    throughDate === undefined
      ? history.weight
      : history.weight.filter((point) => point.date <= throughDate);
  const bodyFat =
    throughDate === undefined
      ? history.bodyFat
      : history.bodyFat.filter((point) => point.date <= throughDate);
  const lines: string[] = [];
  if (weight.length > 0) {
    lines.push(
      "",
      'Body weight history (oldest first; "user" and "garmin" values are measurements, "coach" values are earlier estimates):',
      ...recentMetricLines(weight, (value) => `${value.toFixed(1)} kg`),
    );
  }
  if (bodyFat.length > 0) {
    lines.push(
      "",
      'Body fat history (oldest first; "user" and "garmin" values are measurements, "coach" values are earlier estimates):',
      ...recentMetricLines(bodyFat, (value) => `${value.toFixed(1)} %`),
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
 * A readable exercise label from Garmin's FIT enum values, preferring the
 * sub-category name over the parent category when both are present.
 */
function exerciseLabel(set: StrengthSet): string {
  const exercise = set.exercises[0];
  const raw = exercise?.name ?? exercise?.category ?? "Set";
  const words = raw.trim().toLowerCase().replace(/[_-]+/g, " ").split(/\s+/);
  const label = words.filter((word) => word !== "").join(" ");
  return label === ""
    ? "Set"
    : `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

interface StrengthGroup {
  label: string;
  repetitions: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
  count: number;
}

/** Groups identical active sets so a 5×5 session reads as one line. */
function strengthGroups(sets: readonly StrengthSet[]): StrengthGroup[] {
  const groups = new Map<string, StrengthGroup>();
  for (const set of sets) {
    if (set.setType === "rest") {
      continue;
    }
    const repetitions = set.repetitions ?? null;
    const weightKg = set.weightKg ?? null;
    const durationSeconds = set.durationSeconds ?? null;
    const label = exerciseLabel(set);
    const key = `${label}\u0000${repetitions}\u0000${weightKg}\u0000${durationSeconds}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, {
        label,
        repetitions,
        weightKg,
        durationSeconds,
        count: 1,
      });
    } else {
      group.count += 1;
    }
  }
  return [...groups.values()];
}

function formatStrengthGroup(group: StrengthGroup): string {
  const work =
    group.repetitions !== null
      ? `${group.count} × ${group.repetitions} reps`
      : group.durationSeconds !== null
        ? `${group.count} × ${formatDuration(group.durationSeconds)}`
        : `${group.count} ${group.count === 1 ? "set" : "sets"}`;
  return group.weightKg !== null
    ? `${group.label}: ${work} at ${group.weightKg} kg`
    : `${group.label}: ${work}`;
}

function restRange(sets: readonly StrengthSet[]): string | null {
  const rests = sets
    .filter((set) => set.setType === "rest")
    .map((set) => set.durationSeconds)
    .filter((value): value is number => value !== undefined && value > 0);
  if (rests.length === 0) {
    return null;
  }
  const least = Math.round(Math.min(...rests));
  const most = Math.round(Math.max(...rests));
  return least === most
    ? `Rest between sets: ${least} s`
    : `Rest between sets: ${least}-${most} s`;
}

/** One compact line describing the recorded work, for the plan prompt. */
export function summarizeStrengthSets(sets: readonly StrengthSet[]): string {
  const parts = strengthGroups(sets).map(formatStrengthGroup);
  const rest = restRange(sets);
  if (rest !== null) {
    parts.push(rest);
  }
  return parts.join("; ");
}

/** Renders the recorded strength work for an activity-review prompt. */
export function formatStrengthSets(sets: readonly StrengthSet[]): string[] {
  const groups = strengthGroups(sets);
  const rest = restRange(sets);
  if (groups.length === 0 && rest === null) {
    return [];
  }
  return [
    "Recorded strength sets:",
    ...groups.slice(0, 40).map((group) => `- ${formatStrengthGroup(group)}`),
    ...(rest !== null ? [`- ${rest}`] : []),
  ];
}

/** The label for an activity's mean speed, using pace for pace-based sports. */
function averageSpeedLabel(type: string): string {
  return activityUsesPace(type) ? "Average pace" : "Average speed";
}

/** The label for an activity's fastest speed, using pace for pace-based sports. */
function fastestSpeedLabel(type: string): string {
  return activityUsesPace(type) ? "Fastest pace" : "Maximum speed";
}

/**
 * Renders one recorded lap's averages for a prompt. Only recorded values are
 * listed, so a lap without power or heart rate does not claim a zero.
 */
function formatLap(lap: ActivityLap, activityType: string): string | null {
  const parts: string[] = [];
  const duration = lap.movingTime ?? lap.elapsedTime;
  if (duration !== undefined) {
    parts.push(formatDuration(duration));
  }
  if (lap.distance !== undefined && lap.distance > 0) {
    parts.push(`${(lap.distance / 1000).toFixed(2)} km`);
  }
  if (lap.averagePower !== undefined) {
    parts.push(`avg ${Math.round(lap.averagePower)} W`);
  }
  if (lap.maxPower !== undefined) {
    parts.push(`max ${Math.round(lap.maxPower)} W`);
  }
  if (lap.averageSpeed !== undefined && lap.averageSpeed > 0) {
    const paceOrSpeed = formatActivityPaceOrSpeed(
      activityType,
      lap.averageSpeed,
    );
    if (paceOrSpeed !== null) {
      parts.push(paceOrSpeed);
    }
  }
  if (lap.averageHeartRate !== undefined) {
    parts.push(`avg ${Math.round(lap.averageHeartRate)} bpm`);
  }
  if (lap.maxHeartRate !== undefined) {
    parts.push(`max ${Math.round(lap.maxHeartRate)} bpm`);
  }
  if (lap.averageCadence !== undefined) {
    parts.push(
      `${Math.round(lap.averageCadence)} ${cadenceUnit(activityType)}`,
    );
  }
  if (lap.totalElevationGain !== undefined && lap.totalElevationGain > 0) {
    parts.push(`${Math.round(lap.totalElevationGain)} m climb`);
  }
  if (parts.length === 0) {
    return null;
  }
  const label = lap.type === undefined ? "" : ` (${lap.type})`;
  return `- Lap ${lap.index}${label}: ${parts.join(", ")}`;
}

/**
 * Renders the recorded laps with their averages, so the coach can judge
 * whether an interval or tempo session was executed as prescribed. Bounded so
 * a long auto-lap ride cannot dominate the prompt.
 */
export function formatLaps(
  laps: readonly ActivityLap[],
  activityType: string,
): string[] {
  const shown = laps.slice(0, MAX_PROMPT_LAPS);
  const lines = shown
    .map((lap) => formatLap(lap, activityType))
    .filter((line): line is string => line !== null);
  if (lines.length === 0) {
    return [];
  }
  if (laps.length > shown.length) {
    lines.push(`(${shown.length} of ${laps.length} recorded laps shown.)`);
  }
  return ["Recorded laps:", ...lines];
}

/** The min–max range of a lap channel with one unit, or null when unrecorded. */
function lapRange(
  values: readonly (number | undefined)[],
  unit: string,
): string | null {
  const recorded = values.filter(
    (value): value is number => value !== undefined && Number.isFinite(value),
  );
  if (recorded.length === 0) {
    return null;
  }
  const min = Math.round(Math.min(...recorded));
  const max = Math.round(Math.max(...recorded));
  return min === max ? `${min} ${unit}` : `${min}–${max} ${unit}`;
}

/**
 * A compact one-line lap summary for the plan and reply prompts. The activity
 * analysis gets the full table; every other prompt only needs to know that the
 * session had interval structure and how hard the laps were.
 */
export function summarizeLaps(laps: readonly ActivityLap[]): string {
  const parts = [`${laps.length} recorded`];
  const power = lapRange(
    laps.map((lap) => lap.averagePower),
    "W",
  );
  if (power !== null) {
    parts.push(`lap avg power ${power}`);
  }
  const heartRate = lapRange(
    laps.map((lap) => lap.averageHeartRate),
    "bpm",
  );
  if (heartRate !== null) {
    parts.push(`lap avg HR ${heartRate}`);
  }
  return parts.join(", ");
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
    | "averageSpeed"
    | "maxSpeed"
    | "strengthSets"
    | "laps"
  >,
  sampleCount: number,
): string[] {
  const lines = [
    `- Name: ${activity.name}`,
    `- Type (recorded by the device; may be wrong): ${activity.type}`,
    `- Started: ${activity.startDate}`,
    `- Distance: ${(activity.distance / 1000).toFixed(2)} km`,
    `- Moving time: ${formatDuration(activity.movingTime)}, elapsed time: ${formatDuration(activity.elapsedTime)}`,
    `- Elevation gain: ${Math.round(activity.totalElevationGain)} m`,
  ];
  const averageSpeed = activityAverageSpeed(activity);
  if (averageSpeed !== null) {
    const formatted = formatActivityPaceOrSpeed(activity.type, averageSpeed);
    if (formatted !== null) {
      lines.push(`- ${averageSpeedLabel(activity.type)}: ${formatted}`);
    }
  }
  if (activity.maxSpeed !== null && activity.maxSpeed !== undefined) {
    const formatted = formatActivityPaceOrSpeed(
      activity.type,
      activity.maxSpeed,
    );
    if (formatted !== null) {
      lines.push(`- ${fastestSpeedLabel(activity.type)}: ${formatted}`);
    }
  }
  lines.push(`- Recorded samples: ${sampleCount}`);
  if (activity.strengthSets !== undefined) {
    lines.push(...formatStrengthSets(activity.strengthSets));
  }
  if (hasLapStructure(activity.laps)) {
    lines.push(...formatLaps(activity.laps, activity.type));
  }
  return lines;
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
  const averageSpeed = activityAverageSpeed(summary);
  if (averageSpeed !== null) {
    const paceOrSpeed = formatActivityPaceOrSpeed(summary.type, averageSpeed);
    if (paceOrSpeed !== null) {
      details.push(paceOrSpeed);
    }
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
  if (summary.strengthSets !== undefined && summary.strengthSets.length > 0) {
    lines.push(
      `   Strength sets: ${summarizeStrengthSets(summary.strengthSets)}`,
    );
  }
  if (hasLapStructure(summary.laps)) {
    lines.push(`   Laps: ${summarizeLaps(summary.laps)}`);
  }
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
