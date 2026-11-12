import {
  formatThresholdValue,
  type AthleteEvent,
  type MetricPoint,
  type ThresholdSummary,
} from "@killingit/shared";

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

/** The stored body-composition series handed to a prompt. */
export interface BodyMetricHistory {
  weight: readonly Pick<MetricPoint, "date" | "value" | "source">[];
  bodyFat: readonly Pick<MetricPoint, "date" | "value" | "source">[];
}

/** The most recent answer date, or null when no answer carries one. */
export function latestAnswerDate(
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
 * Renders the stored FTP threshold history and its source meaning for any prompt
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
