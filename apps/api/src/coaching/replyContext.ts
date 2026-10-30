import type { AnalyzedActivity } from "@killingit/shared";
import { toCoachPlanActivity } from "../llm/coachPlanPrompt.js";
import type {
  AthleteAnswerContext,
  PlanContextInput,
} from "../llm/planContext.js";
import {
  loadBodyHistoryForUser,
  loadFtpHistoryForUser,
} from "../metrics/store.js";
import { startOfWeek } from "../plans/dates.js";
import { loadCoachingInputs, type CoachingInputs } from "../plans/inputs.js";
import { ftpBaselineAt } from "../training/ftp.js";
import { loadCachedActivityFeed } from "./feedCache.js";

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
  loadFtpHistory?: typeof loadFtpHistoryForUser;
  loadBodyHistory?: typeof loadBodyHistoryForUser;
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
  const [activities, coachingInputs, ftp, bodyHistory] = await Promise.all([
    attempt("cached activity feed", () =>
      (deps.loadActivities ?? cachedActivities)(userId),
    ),
    attempt("coaching inputs", () =>
      (deps.loadCoachingInputs ?? loadCoachingInputs)(
        userId,
        startOfWeek(today),
      ),
    ),
    attempt("FTP history", () =>
      (deps.loadFtpHistory ?? loadFtpHistoryForUser)(userId, today),
    ),
    attempt("body metrics", () =>
      (deps.loadBodyHistory ?? loadBodyHistoryForUser)(userId),
    ),
  ]);

  return {
    athleteAnswers: input.athleteAnswers,
    recentActivities: (activities ?? []).map(toCoachPlanActivity),
    today,
    manualActivities: coachingInputs?.manualActivities ?? [],
    activityComments: coachingInputs?.activityComments ?? [],
    weeklyNote: coachingInputs?.weeklyNote ?? null,
    weeklyNoteWeekStartDate: coachingInputs?.weeklyNoteWeekStartDate ?? null,
    weeklyNoteReply: coachingInputs?.weeklyNoteReply ?? null,
    periodReviews: coachingInputs?.periodReviews ?? [],
    athleteFtpWatts: ftpBaselineAt(ftp?.timeline ?? null, today)?.watts ?? null,
    ftpHistory: (ftp?.points ?? []).filter((point) => point.date <= today),
    thresholds: ftp?.summaries ?? [],
    ...(bodyHistory !== null ? { bodyHistory } : {}),
  };
}
