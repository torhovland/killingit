import {
  eventEndDate,
  type AthleteEvent,
  type AthleteEventsResult,
} from "@killingit/shared";
import type { StoredWeeklyNote } from "../plans/inputs.js";
import { saveCoachQuestions } from "../plans/coachQuestions.js";
import { replaceAthleteEvents } from "../events/store.js";
import { extractAthleteEvents } from "../llm/athleteEvents.js";
import type {
  AthleteEventEntry,
  AthleteEventSource,
} from "../llm/athleteEventsPrompt.js";
import type { LlmProvider } from "../llm/openrouter.js";
import type { PlanCompletionCredentials } from "../llm/planCompletion.js";
import type {
  ActivityCommentContext,
  AthleteAnswerContext,
  ManualActivityContext,
  PeriodReviewContext,
} from "../llm/planContext.js";

/** The athlete-authored text the coach reads for dated goals and events. */
export interface AthleteEventInputs {
  answers: readonly AthleteAnswerContext[];
  activityComments: readonly ActivityCommentContext[];
  manualActivities: readonly ManualActivityContext[];
  /** Every stored weekly note, so an earlier week's event is still found. */
  weeklyNotes: readonly StoredWeeklyNote[];
  periodReviews: readonly PeriodReviewContext[];
  /** Answered clarification questions. */
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
 * Builds the dated text the coach reads. The profile is passed separately so
 * the coach can date an answer by the day it was saved; every other statement
 * carries its own date. Newest first, so the newest wording of an event wins.
 */
export function buildAthleteEventSource(
  input: AthleteEventInputs,
  today: string,
): AthleteEventSource {
  const entries: AthleteEventEntry[] = [];
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
export interface AthleteEventDependencies {
  extract?: typeof extractAthleteEvents;
  save?: typeof replaceAthleteEvents;
  saveQuestions?: typeof saveCoachQuestions;
}

/**
 * Reads the dated goals and events the athlete states in their own words and
 * stores them for the calendar and the plan prompts. Reading is the coach's job
 * so no phrase list decides what "the marathon in March" means.
 *
 * A model failure is fail-open: the previously stored events stay usable and
 * the caller carries on. The returned result is null when nothing was read.
 */
export async function syncAthleteEvents(input: {
  userId: number;
  today: string;
  source: AthleteEventSource;
  provider: LlmProvider;
  credentials: PlanCompletionCredentials;
  dependencies?: AthleteEventDependencies;
}): Promise<AthleteEventsResult | null> {
  const extract = input.dependencies?.extract ?? extractAthleteEvents;
  const save = input.dependencies?.save ?? replaceAthleteEvents;
  const saveQuestions = input.dependencies?.saveQuestions ?? saveCoachQuestions;

  let result: AthleteEventsResult;
  try {
    result = await extract(input.provider, input.credentials, input.source);
  } catch (err) {
    console.error(
      "[events] could not read the athlete's goals and events:",
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
        sourceKind: "athlete_events",
      });
    } catch (err) {
      console.error("[events] could not store a coach question:", err);
    }
  }

  try {
    await save(input.userId, normalizeEvents(result.events, input.today));
  } catch (err) {
    console.error("[events] could not store the athlete's events:", err);
  }
  return result;
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
