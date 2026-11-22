import type { LlmClient } from "../../../apps/api/src/llm/client.js";
import type { ActivityFeed } from "../../../apps/api/src/coaching/feed/presenter.js";
import { db } from "../../../apps/api/src/db/index.js";
import {
  llmModelSync,
  athleteThresholds,
} from "../../../apps/api/src/db/schema.js";
import { dbQuestionAnswerStore } from "../../../apps/api/src/questions/answers.js";
import { createQuestion } from "../../../apps/api/src/questions/store.js";
import { dbUserStore } from "../../../apps/api/src/users/store.js";
import { replaceAthleteEvents } from "../../../apps/api/src/events/store.js";
import {
  recordGarminBodyMetrics,
  recordGarminFtp,
} from "../../../apps/api/src/metrics/store.js";
import { saveWeeklyNote } from "../../../apps/api/src/plans/inputs.js";
import {
  dbPlanStore,
  dbPlanGenerationStore,
  loadValidatedPlan,
} from "../../../apps/api/src/plans/store.js";
import type { PlanTriggerDependencies } from "../../../apps/api/src/plans/trigger.js";
import {
  prepareTestDatabase,
  truncateAllTables,
} from "../../../apps/api/testDatabase/database.js";
import {
  ATHLETE,
  GRAVEL_RACE,
  HALF_MARATHON,
  PROFILE_TEXT,
  SEASON_EVENT_TITLES,
  START_DATE,
} from "./config.js";
import type { Capability } from "./types.js";
import { syntheticForecast } from "./weather.js";

/** Rebuilds the dedicated simulation database and applies every migration. */
export async function prepareSimulationDatabase(
  databaseUrl: string,
): Promise<void> {
  await prepareTestDatabase(databaseUrl);
}

export interface SeededAthlete {
  userId: number;
}

/** Clears the schema and seeds the athlete, profile, goals and thresholds. */
export async function seedAthlete(): Promise<SeededAthlete> {
  await truncateAllTables();
  await db.insert(llmModelSync).values({ id: 1, lastCheckedAt: new Date() });

  const user = await dbUserStore.ensureUser("season-sim|athlete");
  await dbUserStore.updateSettings(user.sub, {
    timezone: ATHLETE.timezone,
    location: ATHLETE.location,
    dietAdvice: false,
  });

  const question = await createQuestion({
    prompt: "Tell me about yourself, your training history and your goals.",
    required: true,
  });
  const saved = await dbQuestionAnswerStore.saveAnswers(user.id, [
    {
      questionId: question.id,
      versionId: question.versionId,
      answer: PROFILE_TEXT,
    },
  ]);
  if (!saved) {
    throw new Error("failed to save the simulated athlete's profile");
  }

  await replaceAthleteEvents(user.id, [
    {
      startDate: HALF_MARATHON.date,
      endDate: null,
      title: SEASON_EVENT_TITLES.half,
      kind: "race",
    },
    {
      startDate: GRAVEL_RACE.date,
      endDate: null,
      title: SEASON_EVENT_TITLES.gravel,
      kind: "race",
    },
  ]);

  await recordGarminFtp(user.id, [
    { date: START_DATE, watts: ATHLETE.startFtpWatts },
  ]);
  await recordGarminBodyMetrics(user.id, [
    { date: START_DATE, weightKg: ATHLETE.weightKg },
  ]);
  await writeThresholds(user.id, START_DATE, {
    ftpWatts: ATHLETE.startFtpWatts,
    runThresholdSecPerKm: ATHLETE.startRunThresholdSecPerKm,
  });

  return { userId: user.id };
}

/**
 * Stores the modelled ability as a Garmin-style estimate for the day. A real
 * device updates FTP and threshold pace when it detects a change, so a dated
 * series is the natural shape for the harness too.
 */
export async function writeThresholds(
  userId: number,
  date: string,
  capability: Capability,
): Promise<void> {
  await recordGarminFtp(userId, [
    { date, watts: Math.round(capability.ftpWatts) },
  ]);
  await upsertThreshold(userId, date, {
    sport: "running",
    measure: "threshold_pace",
    label: "Threshold pace",
    unit: "s/km",
    kind: "pace",
    value: Math.round(capability.runThresholdSecPerKm),
  });
  for (const sport of ["running", "cycling"] as const) {
    await upsertThreshold(userId, date, {
      sport,
      measure: "threshold_heart_rate",
      label: "Threshold heart rate",
      unit: "bpm",
      kind: "heart_rate",
      value: ATHLETE.thresholdHeartRate,
    });
  }
}

async function upsertThreshold(
  userId: number,
  date: string,
  threshold: {
    sport: string;
    measure: string;
    label: string;
    unit: string;
    kind: "pace" | "heart_rate" | "power";
    value: number;
  },
): Promise<void> {
  await db
    .insert(athleteThresholds)
    .values({
      userId,
      date,
      sport: threshold.sport,
      measure: threshold.measure,
      label: threshold.label,
      unit: threshold.unit,
      kind: threshold.kind,
      source: "garmin",
      value: threshold.value,
    })
    .onConflictDoUpdate({
      target: [
        athleteThresholds.userId,
        athleteThresholds.sport,
        athleteThresholds.measure,
        athleteThresholds.date,
      ],
      set: {
        label: threshold.label,
        unit: threshold.unit,
        kind: threshold.kind,
        source: "garmin",
        value: threshold.value,
        updatedAt: new Date(),
      },
    });
}

/** Stores the athlete's positive weekly note for the week ending `weekEnd`. */
export async function writeWeeklyFeedback(
  userId: number,
  weekEnd: string,
  note: string,
): Promise<void> {
  await saveWeeklyNote(userId, weekEnd, note);
}

/** The validated stored plan, or null before the first build. */
export async function loadPlan(userId: number) {
  const stored = await loadValidatedPlan(dbPlanStore, userId);
  return stored?.plan ?? null;
}

export interface PlanDependencyInput {
  llm: LlmClient;
  feed: () => ActivityFeed;
  today: () => string;
}

/** The production plan-run dependencies with the harness seams injected. */
export function planDependencies(
  input: PlanDependencyInput,
): PlanTriggerDependencies {
  return {
    users: dbUserStore,
    answers: dbQuestionAnswerStore,
    plans: dbPlanStore,
    generations: dbPlanGenerationStore,
    loadActivities: () => Promise.resolve(input.feed()),
    loadLlm: () => Promise.resolve(input.llm),
    syncAthleteReading: () => Promise.resolve(null),
    latestActivityAnalysisSince: () => Promise.resolve(null),
    loadForecast: () => Promise.resolve(syntheticForecast(input.today(), 14)),
  };
}
