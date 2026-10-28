import type { AthleteMetricsResult } from "@killingit/shared";
import { extractAthleteMetrics } from "../llm/athleteMetrics.js";
import type {
  AthleteMetricEntry,
  AthleteMetricSource,
} from "../llm/athleteMetricsPrompt.js";
import type { LlmProvider } from "../llm/openrouter.js";
import type { PlanCompletionCredentials } from "../llm/planCompletion.js";
import type {
  ActivityCommentContext,
  AthleteAnswerContext,
  ManualActivityContext,
  PeriodReviewContext,
} from "../llm/planContext.js";
import { recordAthleteMetricStatements } from "../metrics/store.js";

/** The athlete-authored text the coach reads for stated measurements. */
export interface AthleteMetricInputs {
  answers: readonly AthleteAnswerContext[];
  activityComments: readonly ActivityCommentContext[];
  manualActivities: readonly ManualActivityContext[];
  weeklyNote: string | null;
  weeklyNoteUpdatedAt: Date | null;
  periodReviews: readonly PeriodReviewContext[];
}

/** The day part of an ISO timestamp or date. */
function dayOf(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const iso = value instanceof Date ? value.toISOString() : value;
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** The newest answer date, or null when no answer carries one. */
function profileSavedAt(
  answers: readonly AthleteAnswerContext[],
): string | null {
  const days = answers
    .map((answer) => dayOf(answer.answeredAt))
    .filter((day): day is string => day !== null)
    .sort();
  return days.at(-1) ?? null;
}

/**
 * Builds the dated text the coach reads. The profile is passed separately so
 * the coach can date an undated weight by the day the profile was saved; every
 * other statement carries its own date. Newest first, so the newest value for a
 * date is the one the coach reports.
 */
export function buildAthleteMetricSource(
  input: AthleteMetricInputs,
  today: string,
): AthleteMetricSource {
  const entries: AthleteMetricEntry[] = [];
  const add = (
    date: Date | string | null | undefined,
    label: string,
    text: string | null | undefined,
  ): void => {
    const day = dayOf(date);
    if (day === null || day > today || text === null || text === undefined) {
      return;
    }
    if (text.trim().length === 0) {
      return;
    }
    entries.push({ date: day, label, text });
  };

  for (const comment of input.activityComments) {
    add(comment.updatedAt, "activity comment", comment.comment);
  }
  for (const activity of input.manualActivities) {
    add(
      activity.updatedAt ?? activity.startDate,
      "manual activity",
      activity.details,
    );
  }
  add(input.weeklyNoteUpdatedAt, "weekly note", input.weeklyNote);
  for (const review of input.periodReviews) {
    add(review.updatedAt, `${review.kind} review comment`, review.comment);
  }

  entries.sort((a, b) => b.date.localeCompare(a.date));
  return {
    profile: input.answers,
    profileSavedAt: profileSavedAt(input.answers),
    entries,
  };
}

/** Injectable seams so a test can read the prompt without calling a model. */
export interface AthleteMetricDependencies {
  extract?: typeof extractAthleteMetrics;
  save?: typeof recordAthleteMetricStatements;
}

/**
 * Reads the FTP, body weight, and body-fat values the athlete states in their
 * own words and stores them as `user` metric points. Reading is the coach's job
 * so no phrase list decides what "around 240 W" or "down to 12 %" means.
 *
 * A model failure is fail-open: the existing metric series stays usable and the
 * caller carries on. The returned result is null when nothing was read.
 */
export async function syncAthleteMetrics(input: {
  userId: number;
  today: string;
  source: AthleteMetricSource;
  provider: LlmProvider;
  credentials: PlanCompletionCredentials;
  dependencies?: AthleteMetricDependencies;
}): Promise<AthleteMetricsResult | null> {
  const extract = input.dependencies?.extract ?? extractAthleteMetrics;
  const save = input.dependencies?.save ?? recordAthleteMetricStatements;

  let result: AthleteMetricsResult;
  try {
    result = await extract(input.provider, input.credentials, input.source);
  } catch (err) {
    console.error(
      "[metrics] could not read the athlete's stated metrics:",
      err,
    );
    return null;
  }

  const statements = newestPerDate(result.statements, input.today);
  if (statements.length === 0) {
    return result;
  }
  try {
    await save(input.userId, statements, input.today);
  } catch (err) {
    console.error(
      "[metrics] could not store the athlete's stated metrics:",
      err,
    );
  }
  return result;
}

/**
 * Keeps the newest statement for each date and drops future dates. The coach is
 * told to report one value per date, but a repeated date would otherwise race
 * inside the single write loop.
 */
function newestPerDate(
  statements: AthleteMetricsResult["statements"],
  today: string,
): AthleteMetricsResult["statements"] {
  const byDate = new Map<string, AthleteMetricsResult["statements"][number]>();
  for (const statement of statements) {
    if (statement.date > today) {
      continue;
    }
    const previous = byDate.get(statement.date);
    byDate.set(statement.date, {
      date: statement.date,
      ftpWatts: statement.ftpWatts ?? previous?.ftpWatts ?? null,
      weightKg: statement.weightKg ?? previous?.weightKg ?? null,
      bodyFatPercent:
        statement.bodyFatPercent ?? previous?.bodyFatPercent ?? null,
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
