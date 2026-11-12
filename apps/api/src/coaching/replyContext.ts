import type { AnalyzedActivity, AthleteEvent } from "@killingit/shared";
import { loadDietContext } from "../diet/context.js";
import { toCoachPlanActivity } from "../llm/activityContext.js";
import type { PlanContextInput } from "../llm/planContext.js";
import type { AthleteAnswerContext } from "../llm/profileContext.js";
import { loadAthleteEvents } from "../events/store.js";
import {
  loadBodyHistoryForUser,
  loadThresholdHistoryForUser,
} from "../metrics/store.js";
import { loadDailyHealthForUser } from "../metrics/dailyMetrics.js";
import { addDays, startOfWeek } from "@killingit/shared";
import { loadCoachingInputs, type CoachingInputs } from "../plans/inputs.js";
import {
  ftpBaselineAt,
  ftpHistoryPoints,
  ftpTimeline,
} from "../training/thresholds.js";
import { currentTrainingLoad } from "../training/load.js";
import {
  loadCachedActivityFeed,
  MAX_ANALYZED_ACTIVITIES,
} from "./feedCache.js";

/** The athlete and the day a reply is written for. */
export interface ReplyContextInput {
  userId: number;
  today: string;
  /** The profile answers, already mapped from the stored questions. */
  athleteAnswers: readonly AthleteAnswerContext[];
}

/**
 * The loaders behind a reply context. Injectable so the assembly is tested
 * without a database; the defaults read the stored data.
 */
export interface ReplyContextDependencies {
  loadActivities?: (userId: number) => Promise<readonly AnalyzedActivity[]>;
  loadCoachingInputs?: (
    userId: number,
    weekStartDate: string,
  ) => Promise<CoachingInputs>;
  loadThresholdHistory?: typeof loadThresholdHistoryForUser;
  loadBodyHistory?: typeof loadBodyHistoryForUser;
  loadDailyHealth?: typeof loadDailyHealthForUser;
  loadEvents?: (userId: number) => Promise<readonly AthleteEvent[]>;
  loadDiet?: typeof loadDietContext;
}

/**
 * Keeps one unavailable source from emptying the whole context: an unconnected
 * Garmin account or a metrics outage must still leave a coach reply possible.
 */
async function attempt<T>(
  label: string,
  load: () => Promise<T>,
): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    console.error(`[coach-reply] could not read the ${label}:`, err);
    return null;
  }
}

async function cachedActivities(
  userId: number,
): Promise<readonly AnalyzedActivity[]> {
  const feed = await loadCachedActivityFeed(userId);
  return feed?.activities ?? [];
}

/**
 * The athlete and training context for a reply, built exactly like the plan
 * prompts' context so the coach answers a question from the same picture it
 * plans from. The last synced activity feed is used rather than a Garmin sync:
 * a reply is interactive, and the plan revision that follows it syncs anyway.
 */
export async function loadReplyContext(
  input: ReplyContextInput,
  deps: ReplyContextDependencies = {},
): Promise<PlanContextInput> {
  const { userId, today } = input;
  const [
    activities,
    coachingInputs,
    history,
    bodyHistory,
    dailyHealth,
    events,
    diet,
  ] = await Promise.all([
    attempt("cached activity feed", () =>
      (deps.loadActivities ?? cachedActivities)(userId),
    ),
    attempt("coaching inputs", () =>
      (deps.loadCoachingInputs ?? loadCoachingInputs)(
        userId,
        startOfWeek(today),
      ),
    ),
    attempt("threshold history", () =>
      (deps.loadThresholdHistory ?? loadThresholdHistoryForUser)(userId, today),
    ),
    attempt("body metrics", () =>
      (deps.loadBodyHistory ?? loadBodyHistoryForUser)(userId),
    ),
    attempt("daily health metrics", () =>
      (deps.loadDailyHealth ?? loadDailyHealthForUser)(
        userId,
        addDays(today, -42),
        today,
      ),
    ),
    attempt("athlete events", () =>
      (deps.loadEvents ?? loadAthleteEvents)(userId),
    ),
    attempt("food log", () =>
      (deps.loadDiet ?? loadDietContext)(userId, today),
    ),
  ]);

  const currentForm = currentTrainingLoad(
    {
      activities: activities ?? [],
      manualActivities: coachingInputs?.manualActivities ?? [],
      thresholdTimelines: history?.timelines ?? [],
    },
    today,
  );

  return {
    athleteAnswers: input.athleteAnswers,
    recentActivities: (activities ?? [])
      .slice(0, MAX_ANALYZED_ACTIVITIES)
      .map(toCoachPlanActivity),
    today,
    ...(currentForm !== null ? { currentForm } : {}),
    manualActivities: coachingInputs?.manualActivities ?? [],
    activityComments: coachingInputs?.activityComments ?? [],
    weeklyNote: coachingInputs?.weeklyNote ?? null,
    weeklyNoteWeekStartDate: coachingInputs?.weeklyNoteWeekStartDate ?? null,
    weeklyNoteReply: coachingInputs?.weeklyNoteReply ?? null,
    periodReviews: coachingInputs?.periodReviews ?? [],
    athleteFtpWatts:
      ftpBaselineAt(ftpTimeline(history?.timelines ?? []), today)?.watts ??
      null,
    ftpHistory: ftpHistoryPoints(history?.timelines ?? []),
    thresholds: history?.summaries ?? [],
    ...(bodyHistory !== null ? { bodyHistory } : {}),
    ...(dailyHealth !== null ? { dailyHealth } : {}),
    ...(events !== null && events.length > 0 ? { events } : {}),
    ...(diet !== null ? { diet } : {}),
  };
}
