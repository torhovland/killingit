import { type AnalyzedActivity, type CoachAnalysis } from "@killingit/shared";
import { eq } from "drizzle-orm";
import { decrypt } from "../crypto/credentials.js";
import { db } from "../db/index.js";
import { activityFeedCache, llmSettings, users } from "../db/schema.js";
import { llmCredentialsKeyFromEnv } from "../llm/credentials.js";
import type { CoachingInputs } from "../plans/inputs.js";
import { loadCoachingInputs } from "../plans/inputs.js";
import { startOfWeek } from "../plans/dates.js";
import {
  latestActivityAnalysisTimestamp,
  latestAnswerTimestamp,
} from "../plans/status.js";
import { dbQuestionAnswerStore } from "../questions/answers.js";

export interface BenchmarkFixture {
  userId: number;
  apiKey: string;
  answers: Awaited<ReturnType<typeof dbQuestionAnswerStore.listForUser>>;
  answersUpdatedAt: Date | null;
  activities: AnalyzedActivity[];
  activitiesUpdatedAt: Date | null;
  fullInputs: CoachingInputs;
  refreshInputs: CoachingInputs;
}

async function resolveUserId(requested: number | null): Promise<number> {
  if (requested !== null) {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, requested))
      .limit(1);
    if (rows.length === 0) {
      throw new Error(`No user with id ${requested} in this database`);
    }
    return requested;
  }

  const rows = await db.select({ id: users.id }).from(users).orderBy(users.id);
  if (rows.length === 0) {
    throw new Error("The database has no users to benchmark");
  }
  if (rows.length > 1) {
    throw new Error(
      `The database has ${rows.length} users; pass --user-id to choose the athlete`,
    );
  }
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("The database has no users to benchmark");
  }
  return id;
}

async function resolveApiKey(userId: number): Promise<string> {
  const fromEnv = process.env.BENCHMARK_API_KEY?.trim();
  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv;
  }

  const rows = await db
    .select({ apiKeyEncrypted: llmSettings.apiKeyEncrypted })
    .from(llmSettings)
    .where(eq(llmSettings.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(
      "Set BENCHMARK_API_KEY or configure an OpenRouter key for this account",
    );
  }
  return decrypt(row.apiKeyEncrypted, await llmCredentialsKeyFromEnv());
}

function asCoachAnalysis(value: unknown): CoachAnalysis | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const entry = value as {
    text?: unknown;
    model?: unknown;
    generatedAt?: unknown;
  };
  if (
    typeof entry.text !== "string" ||
    typeof entry.model !== "string" ||
    typeof entry.generatedAt !== "string"
  ) {
    return null;
  }
  return {
    text: entry.text,
    model: entry.model,
    generatedAt: entry.generatedAt,
  };
}

/**
 * Reads the athlete context that the app would use for a plan generation. The
 * benchmark deliberately reads the cached activity feed rather than syncing
 * Garmin, so a run is deterministic and does not touch the athlete's device
 * connection.
 */
export async function loadBenchmarkFixture(input: {
  userId: number | null;
  today: string;
  refreshToday: string;
}): Promise<BenchmarkFixture> {
  const userId = await resolveUserId(input.userId);
  const [apiKey, answers, feedRows, fullInputs, refreshInputs] =
    await Promise.all([
      resolveApiKey(userId),
      dbQuestionAnswerStore.listForUser(userId),
      db
        .select({ feed: activityFeedCache.feed })
        .from(activityFeedCache)
        .where(eq(activityFeedCache.userId, userId))
        .limit(1),
      loadCoachingInputs(userId, startOfWeek(input.today)),
      loadCoachingInputs(userId, startOfWeek(input.refreshToday)),
    ]);
  const answersUpdatedAt = latestAnswerTimestamp(answers);

  const feed = feedRows[0]?.feed;
  const activities = (feed?.activities ?? []).map(
    (activity): AnalyzedActivity => ({
      id: activity.id,
      name: activity.name,
      type: activity.type,
      startDate: activity.startDate,
      distance: activity.distance,
      movingTime: activity.movingTime,
      elapsedTime: activity.elapsedTime,
      totalElevationGain: activity.totalElevationGain,
      sampleCount: activity.sampleCount,
      analysis: asCoachAnalysis(activity.analysis),
      analysisError: activity.analysisError,
      programAnalysis: asCoachAnalysis(activity.programAnalysis),
      comment: activity.comment,
      coachReply: asCoachAnalysis(activity.coachReply),
      ...(activity.reviewed !== undefined
        ? { reviewed: activity.reviewed }
        : {}),
    }),
  );

  return {
    userId,
    apiKey,
    answers,
    answersUpdatedAt,
    activities,
    activitiesUpdatedAt: latestActivityAnalysisTimestamp(activities),
    fullInputs,
    refreshInputs,
  };
}
