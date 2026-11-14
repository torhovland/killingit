import { type AnalyzedActivity } from "@killingit/shared";
import { eq } from "drizzle-orm";
import { loadStoredActivityFeed } from "../../../apps/api/src/coaching/activityStore.js";
import { decrypt } from "../../../apps/api/src/crypto/credentials.js";
import { db } from "../../../apps/api/src/db/index.js";
import { llmSettings, users } from "../../../apps/api/src/db/schema.js";
import { llmCredentialsKeyFromEnv } from "../../../apps/api/src/llm/credentials.js";
import type { CoachingInputs } from "../../../apps/api/src/plans/inputs.js";
import { loadCoachingInputs } from "../../../apps/api/src/plans/inputs.js";
import { startOfWeek } from "@killingit/shared";
import {
  latestActivityAnalysisTimestamp,
  latestAnswerTimestamp,
} from "../../../apps/api/src/plans/status.js";
import { dbQuestionAnswerStore } from "../../../apps/api/src/questions/answers.js";

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

/**
 * Reads the athlete context that the app would use for a plan generation. The
 * benchmark deliberately reads the stored activity rows rather than syncing
 * Garmin, so a run is deterministic and does not touch the athlete's device
 * connection.
 */
export async function loadBenchmarkFixture(input: {
  userId: number | null;
  today: string;
  refreshToday: string;
}): Promise<BenchmarkFixture> {
  const userId = await resolveUserId(input.userId);
  const [apiKey, answers, feed, fullInputs, refreshInputs] = await Promise.all([
    resolveApiKey(userId),
    dbQuestionAnswerStore.listForUser(userId),
    loadStoredActivityFeed(userId),
    loadCoachingInputs(userId, startOfWeek(input.today)),
    loadCoachingInputs(userId, startOfWeek(input.refreshToday)),
  ]);
  const answersUpdatedAt = latestAnswerTimestamp(answers);
  const activities: AnalyzedActivity[] = feed.activities;

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
