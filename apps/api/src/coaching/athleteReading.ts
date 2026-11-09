import {
  eventEndDate,
  formatThresholdValue,
  type AthleteEvent,
  type AthleteMetricStatement,
  type AthleteReadingResult,
  type AthleteThresholdStatement,
} from "@killingit/shared";
import { replaceAthleteEvents } from "../events/store.js";
import { extractAthleteReading } from "../llm/athleteReading.js";
import type {
  AthleteReadingEntry,
  AthleteReadingSource,
} from "../llm/athleteReadingPrompt.js";
import type { LlmProvider } from "../llm/openrouter.js";
import type { PlanCompletionCredentials } from "../llm/planCompletion.js";
import type {
  ActivityCommentContext,
  AthleteAnswerContext,
  ManualActivityContext,
  PeriodReviewContext,
} from "../llm/planContext.js";
import { recordAthleteMetricStatements } from "../metrics/store.js";
import { saveCoachQuestions } from "../plans/coachQuestions.js";
import type { StoredWeeklyNote } from "../plans/inputs.js";

/** The athlete-authored text the coach reads for measurements and events. */
export interface AthleteReadingInputs {
  answers: readonly AthleteAnswerContext[];
  activityComments: readonly ActivityCommentContext[];
  manualActivities: readonly ManualActivityContext[];
  /** Every stored weekly note, so an earlier week's event is still found. */
  weeklyNotes: readonly StoredWeeklyNote[];
  periodReviews: readonly PeriodReviewContext[];
  /** Answered clarification questions, including a threshold's missing sport. */
  coachQuestionAnswers?: readonly {
    question: string;
    answer: string;
    answeredAt: Date | string | null;
  }[];
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
 * Builds the dated text the coach reads. Newest first, so the newest wording of
 * a measurement or event wins. The profile is passed separately so the coach
 * can date an undated profile value by the day the profile was saved.
 */
export function buildAthleteReadingSource(
  input: AthleteReadingInputs,
  today: string,
): AthleteReadingSource {
  const entries: AthleteReadingEntry[] = [];
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
  for (const note of input.weeklyNotes) {
    add(note.weekStartDate, "weekly note", note.note);
  }
  for (const review of input.periodReviews) {
    add(review.updatedAt, `${review.kind} review comment`, review.comment);
  }
  for (const answer of input.coachQuestionAnswers ?? []) {
    add(
      answer.answeredAt,
      `answer to coach question "${answer.question}"`,
      answer.answer,
    );
  }

  entries.sort((a, b) => b.date.localeCompare(a.date));
  return {
    profile: input.answers,
    profileSavedAt: profileSavedAt(input.answers),
    entries,
    today,
  };
}

/** Injectable seams so a test can read the prompt without calling a model. */
export interface AthleteReadingDependencies {
  extract?: typeof extractAthleteReading;
  saveMetrics?: typeof recordAthleteMetricStatements;
  saveEvents?: typeof replaceAthleteEvents;
  saveQuestions?: typeof saveCoachQuestions;
}

/**
 * Reads the measurements, goals and events the athlete states in their own
 * words and stores them. One model call covers both readings, so the athlete's
 * text is sent once.
 *
 * A model failure is fail-open: the existing metric series and events stay
 * usable and the caller carries on. The returned result is null when the
 * reading failed.
 */
export async function syncAthleteReading(input: {
  userId: number;
  today: string;
  source: AthleteReadingSource;
  provider: LlmProvider;
  credentials: PlanCompletionCredentials;
  dependencies?: AthleteReadingDependencies;
}): Promise<AthleteReadingResult | null> {
  const extract = input.dependencies?.extract ?? extractAthleteReading;
  const saveMetrics =
    input.dependencies?.saveMetrics ?? recordAthleteMetricStatements;
  const saveEvents = input.dependencies?.saveEvents ?? replaceAthleteEvents;
  const saveQuestions = input.dependencies?.saveQuestions ?? saveCoachQuestions;

  let result: AthleteReadingResult;
  try {
    result = await extract(input.provider, input.credentials, input.source);
  } catch (err) {
    console.error(
      "[athlete-reading] could not read the athlete's own words:",
      err,
    );
    return null;
  }

  if (result.coachQuestion !== undefined && result.coachQuestion !== null) {
    try {
      await saveQuestions({
        userId: input.userId,
        questions: [result.coachQuestion],
        model: input.credentials.model,
        sourceKind: "athlete_reading",
      });
    } catch (err) {
      console.error("[athlete-reading] could not store a coach question:", err);
    }
  }

  const unresolved = result.statements.flatMap((statement) =>
    statement.thresholds
      .filter((threshold) => threshold.sport === null)
      .map((threshold) =>
        thresholdQuestion(
          threshold.label,
          threshold.value,
          threshold.unit,
          threshold.kind,
        ),
      ),
  );
  if (unresolved.length > 0) {
    try {
      await saveQuestions({
        userId: input.userId,
        questions: unresolved,
        model: input.credentials.model,
        sourceKind: "athlete_reading",
      });
    } catch (err) {
      console.error(
        "[athlete-reading] could not ask for a threshold sport:",
        err,
      );
    }
  }

  const statements = newestPerDate(result.statements, input.today).map(
    (statement) => ({
      ...statement,
      thresholds: statement.thresholds.filter(
        (threshold) => threshold.sport !== null,
      ),
    }),
  );
  if (
    statements.some(
      (statement) =>
        statement.weightKg !== null ||
        statement.bodyFatPercent !== null ||
        statement.thresholds.length > 0,
    )
  ) {
    try {
      await saveMetrics(input.userId, statements, input.today);
    } catch (err) {
      console.error(
        "[athlete-reading] could not store the athlete's measurements:",
        err,
      );
    }
  }

  try {
    await saveEvents(input.userId, normalizeEvents(result.events, input.today));
  } catch (err) {
    console.error(
      "[athlete-reading] could not store the athlete's events:",
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
  statements: readonly AthleteMetricStatement[],
  today: string,
): AthleteMetricStatement[] {
  const byDate = new Map<string, AthleteMetricStatement>();
  for (const statement of statements) {
    if (statement.date > today) {
      continue;
    }
    const previous = byDate.get(statement.date);
    const thresholds = new Map(
      (previous?.thresholds ?? []).map((threshold) => [
        `${threshold.sport ?? "other"}\u0000${threshold.measure}`,
        threshold,
      ]),
    );
    for (const threshold of statement.thresholds) {
      thresholds.set(
        `${threshold.sport ?? "other"}\u0000${threshold.measure}`,
        threshold,
      );
    }
    byDate.set(statement.date, {
      date: statement.date,
      weightKg: statement.weightKg ?? previous?.weightKg ?? null,
      bodyFatPercent:
        statement.bodyFatPercent ?? previous?.bodyFatPercent ?? null,
      thresholds: [...thresholds.values()],
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Asks which sport an otherwise unambiguous threshold belongs to. The value is
 * shown in its athlete-facing unit, so a pace stored in seconds per kilometre
 * reads as `5:46 /km` rather than `346 s/km`.
 */
function thresholdQuestion(
  label: string,
  value: number,
  unit: string,
  kind: AthleteThresholdStatement["kind"],
): string {
  return `You mentioned ${label} ${formatThresholdValue(value, unit, kind)}. Which sport is that threshold for?`;
}

/**
 * Keeps only events that are still relevant, with a sane date range. An event
 * that ended before today is dropped; an event that started earlier but is
 * still running is kept. A malformed end date falls back to a one-day event.
 */
export function normalizeEvents(
  events: readonly AthleteEvent[],
  today: string,
): AthleteEvent[] {
  const byKey = new Map<string, AthleteEvent>();
  for (const event of events) {
    const title = event.title.trim();
    if (title === "") {
      continue;
    }
    const endDate =
      event.endDate !== null && event.endDate >= event.startDate
        ? event.endDate
        : null;
    const normalized: AthleteEvent = {
      startDate: event.startDate,
      endDate,
      title,
      kind: event.kind,
    };
    if (eventEndDate(normalized) < today) {
      continue;
    }
    byKey.set(
      `${normalized.startDate}\u0000${normalized.endDate ?? ""}\u0000${title}`,
      normalized,
    );
  }
  return [...byKey.values()].sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );
}
