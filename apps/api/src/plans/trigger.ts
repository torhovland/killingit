import type { ActivityFeed } from "../coaching/activities.js";
import { loadAnalyzedActivities } from "../coaching/activities.js";
import { latestActivityAnalysisSince } from "../coaching/analysisRuns.js";
import { MAX_ANALYZED_ACTIVITIES } from "../coaching/feedCache.js";
import {
  buildAthleteReadingSource,
  syncAthleteReading,
} from "../coaching/athleteReading.js";
import { loadAthleteEvents } from "../events/store.js";
import { loadDietContext } from "../diet/context.js";
import { captureCompletedPeriodReviews } from "../coaching/periodReviews.js";
import { markPlanPromptsFailed } from "../llm/callStore.js";
import type { LlmClient } from "../llm/client.js";
import { loadLlmClient } from "../llm/client.js";
import {
  loadBodyHistoryForUser,
  loadThresholdHistoryForUser,
  recordCoachBodyMetrics,
  recordPlanFtpEstimates,
} from "../metrics/store.js";
import { loadDailyHealthForUser } from "../metrics/dailyMetrics.js";
import {
  addDays,
  startOfWeek,
  type AthleteLocation,
  type DailyHealthPoint,
  type DailyWeather,
  type PlanGenerateMode,
} from "@killingit/shared";
import type { QuestionAnswerStore } from "../questions/answers.js";
import {
  dbCoachingSurveyAdjustmentStore,
  type CoachingSurveyAdjustmentStore,
} from "../questions/adjustments.js";
import type { UserStore } from "../users/store.js";
import {
  fetchWeatherForecasts,
  type WeatherForecastSet,
} from "../weather/forecast.js";
import { ftpHistoryPoints } from "../training/thresholds.js";
import { isAfterPlanTomorrowCutoff } from "./dates.js";
import {
  clearPendingCoachQuestions,
  loadAnsweredCoachQuestions,
  saveCoachQuestions,
} from "./coachQuestions.js";
import {
  GENERATION_HEARTBEAT_MS,
  GenerationSupersededError,
  isGenerationSuperseded,
} from "./generation.js";
import { runPlanGeneration } from "./generate.js";
import { planFtpEstimates } from "./generate.js";
import { loadPlanDayCalories } from "./dayCalories.js";
import { loadCoachingInputs, type CoachingInputs } from "./inputs.js";
import { claimRun, releaseRun } from "./runs.js";
import { PLAN_GENERATION_STEPS } from "./steps.js";
import { athleteTextChanged } from "./athleteText.js";
import {
  latestActivityAnalysisTimestamp,
  latestAnswerTimestamp,
  latestPlanChangingAnalysisTimestamp,
} from "./status.js";
import type { PlanGenerationStore, PlanStore } from "./store.js";

export interface PlanTriggerDependencies {
  users: UserStore;
  answers: QuestionAnswerStore;
  plans: PlanStore;
  generations: PlanGenerationStore;
  /** Survey answers not yet incorporated into the plan. */
  coachingSurveyAdjustments?: CoachingSurveyAdjustmentStore | undefined;
  /** Injectable for route tests; defaults to a Garmin sync. */
  loadActivities?: ((userId: number) => Promise<ActivityFeed>) | undefined;
  /** Injectable for route tests; defaults to the stored threshold timelines. */
  loadThresholdHistory?: typeof loadThresholdHistoryForUser | undefined;
  /** Injectable for route tests; defaults to the stored body metrics. */
  loadBodyHistory?: typeof loadBodyHistoryForUser | undefined;
  /** Injectable for route tests; defaults to the stored daily health series. */
  loadDailyHealth?: typeof loadDailyHealthForUser | undefined;
  /** Injectable for route tests; defaults to the coach reading the text. */
  syncAthleteReading?: typeof syncAthleteReading | undefined;
  /** Injectable for route tests; defaults to the stored events. */
  loadEvents?: typeof loadAthleteEvents | undefined;
  /** Injectable for route tests; defaults to the stored food log. */
  loadDiet?: typeof loadDietContext | undefined;
  /** Injectable for route tests; defaults to answered coach questions. */
  loadAnsweredCoachQuestions?: typeof loadAnsweredCoachQuestions | undefined;
  /** Injectable for route tests; defaults to the account's stored config. */
  loadLlm?: ((userId: number) => Promise<LlmClient | null>) | undefined;
  /** Injectable for route tests; defaults to the database-backed loader. */
  loadCoachingInputs?:
    | ((userId: number, weekStartDate: string) => Promise<CoachingInputs>)
    | undefined;
  /** Injectable for tests; defaults to Open-Meteo and Yr.no. */
  loadForecast?:
    | ((
        location: AthleteLocation,
        timezone: string | null,
      ) => Promise<WeatherForecastSet>)
    | undefined;
  /** Injectable for tests; defaults to the prompt-log writer. */
  markPlanPromptsFailed?: typeof markPlanPromptsFailed | undefined;
  /** Injectable for tests; defaults to {@link PLAN_TRIGGER_DEBOUNCE_MS}. */
  planTriggerDebounceMs?: number | undefined;
}

/** Options shared by the plan-only trigger and a combined coach run. */
export interface PlanRunOptions {
  userId: number;
  today: string;
  timezone?: string;
  mode?: PlanGenerateMode;
  force?: boolean;
  includeTomorrow?: boolean;
  /** Keep today's stored session while revising around a new input. */
  keepToday?: boolean;
}

/**
 * Rapid auto triggers are coalesced for this long. A first trigger starts
 * immediately; a second one inside the window replaces it and starts when the
 * window closes, so saving several inputs in a row does not pay for several
 * aborted plan completions.
 */
export const PLAN_TRIGGER_DEBOUNCE_MS = 1_500;

interface PendingPlanStart {
  timer: ReturnType<typeof setTimeout>;
  run: { runId: string; signal: AbortSignal };
  deps: PlanTriggerDependencies;
  options: PlanRunOptions;
}

const pendingStarts = new Map<number, PendingPlanStart>();
const lastTriggerAt = new Map<number, number>();

/**
 * Starts a plan generation in the background. The newest request always owns
 * the run: an older run is aborted and its writes are fenced by the run id.
 */
export async function triggerPlanGeneration(
  deps: PlanTriggerDependencies,
  options: PlanRunOptions,
): Promise<boolean> {
  const run = claimRun(options.userId);
  await deps.generations.begin(options.userId, run.runId);

  const pending = pendingStarts.get(options.userId);
  if (pending !== undefined) {
    clearTimeout(pending.timer);
    pendingStarts.delete(options.userId);
  }

  const now = Date.now();
  const previousAt = lastTriggerAt.get(options.userId) ?? null;
  lastTriggerAt.set(options.userId, now);
  const explicit =
    options.mode === "newSeason" ||
    options.mode === "updateSeason" ||
    options.force === true;
  const debounceMs = deps.planTriggerDebounceMs ?? PLAN_TRIGGER_DEBOUNCE_MS;
  const waitMs =
    explicit || previousAt === null
      ? 0
      : Math.max(0, debounceMs - (now - previousAt));

  if (waitMs === 0) {
    startBackgroundPlan(deps, options, run);
    return true;
  }

  const timer = setTimeout(() => {
    pendingStarts.delete(options.userId);
    if (!run.signal.aborted) {
      startBackgroundPlan(deps, options, run);
    }
  }, waitMs);
  timer.unref();
  pendingStarts.set(options.userId, { timer, run, deps, options });
  return true;
}

function startBackgroundPlan(
  deps: PlanTriggerDependencies,
  options: PlanRunOptions,
  run: { runId: string; signal: AbortSignal },
): void {
  const heartbeat = startHeartbeat(deps, options.userId, run.runId);
  void runPlanForUser(deps, { ...options, ...run })
    .catch((err: unknown) => {
      if (!isGenerationSuperseded(err)) {
        console.error("[plan] background generation failed:", err);
      }
    })
    .finally(() => {
      clearInterval(heartbeat);
      releaseRun(options.userId, run.runId);
    });
}

/** Refreshes the running row so loading a large feed cannot look like a crash. */
export function startHeartbeat(
  deps: PlanTriggerDependencies,
  userId: number,
  runId: string,
): ReturnType<typeof setInterval> {
  const heartbeat = setInterval(() => {
    void deps.generations.heartbeat(userId, runId).catch((err: unknown) => {
      console.error("[plan] could not refresh generation status:", err);
    });
  }, GENERATION_HEARTBEAT_MS);
  heartbeat.unref();
  return heartbeat;
}

/**
 * Prepares one run and executes it. The caller has already claimed the
 * generation row and owns the heartbeat, so this can run after an optional
 * reply phase in the same run.
 */
export async function runPlanForUser(
  deps: PlanTriggerDependencies,
  options: PlanRunOptions & { runId: string; signal: AbortSignal },
): Promise<void> {
  const { userId, today, timezone, mode, force, keepToday } = options;

  let plan: Awaited<ReturnType<PlanStore["load"]>>;
  let answers: Awaited<ReturnType<QuestionAnswerStore["listForUser"]>>;
  let activities: ActivityFeed;
  let llm: LlmClient | null;
  let coachingInputs: CoachingInputs;
  let user: Awaited<ReturnType<UserStore["getById"]>>;
  let coachAnswers: Awaited<ReturnType<typeof loadAnsweredCoachQuestions>>;
  let surveyAdjustments: Awaited<
    ReturnType<CoachingSurveyAdjustmentStore["listForUser"]>
  >;
  const surveyAdjustmentStore =
    deps.coachingSurveyAdjustments ?? dbCoachingSurveyAdjustmentStore;
  const activitiesSnapshotAt = Date.now();
  const preloadedActivities = deps.loadActivities;

  try {
    // A real plan run owns the Garmin sync, so name that phase separately from
    // the fast database reads that follow. A caller that already holds the
    // analysed feed has nothing to sync and goes straight to preparation.
    if (preloadedActivities === undefined) {
      await deps.generations.update(
        userId,
        PLAN_GENERATION_STEPS.syncActivities,
        options.runId,
      );
    }
    activities =
      preloadedActivities !== undefined
        ? await preloadedActivities(userId)
        : await loadAnalyzedActivities({
            userId,
            // The sidecar syncs 42 days. Analyse the newest activities the
            // cap allows; the plan prompt reviews the same recent window.
            limit: MAX_ANALYZED_ACTIVITIES,
            refresh: false,
          });
    if (preloadedActivities === undefined) {
      await deps.generations.update(
        userId,
        PLAN_GENERATION_STEPS.prepare,
        options.runId,
      );
    }

    [
      plan,
      answers,
      llm,
      coachingInputs,
      user,
      coachAnswers,
      surveyAdjustments,
    ] = await Promise.all([
      deps.plans.load(userId),
      deps.answers.listForUser(userId),
      deps.loadLlm ? deps.loadLlm(userId) : loadLlmClient(userId, "all"),
      deps.loadCoachingInputs
        ? deps.loadCoachingInputs(userId, startOfWeek(today))
        : loadCoachingInputs(userId, startOfWeek(today)),
      deps.users.getById(userId),
      (deps.loadAnsweredCoachQuestions ?? loadAnsweredCoachQuestions)(userId),
      surveyAdjustmentStore.listForUser(userId),
    ]);
  } catch (err) {
    if (options.signal.aborted) {
      throw new GenerationSupersededError();
    }
    const message =
      err instanceof Error ? err.message : "The plan could not be generated.";
    await deps.generations.fail(userId, message, options.runId);
    throw err;
  }

  // The request's zone (the athlete's selected or device zone) wins over the
  // stored setting; an account with neither reads as UTC. Every day derived
  // from an activity in this run uses the same zone.
  const timeZone = timezone ?? user?.timezone ?? null;

  // A server-triggered update (a new analysis, a saved comment, a weekly note)
  // must plan the same levels as the dashboard. After the athlete's local 18:00
  // that includes tomorrow and, at a week boundary, the next week.
  const includeTomorrow =
    options.includeTomorrow ?? isAfterPlanTomorrowCutoff(timeZone);

  // The stored feed keeps every activity ever synced. Prompts stay on the same
  // recent window as the analysis cap so they do not grow with the athlete's
  // entire history.
  let recentActivities = activities.activities.slice(
    0,
    MAX_ANALYZED_ACTIVITIES,
  );

  if (!llm) {
    const message = "OpenRouter is not configured. Add a key and model first.";
    await deps.generations.fail(userId, message, options.runId);
    return;
  }
  if (
    options.signal.aborted ||
    !(await deps.generations.isCurrent(userId, options.runId))
  ) {
    throw new GenerationSupersededError();
  }

  const location = user?.location ?? null;

  // The reading below sees the athlete-authored text. Only a plan run with new
  // text needs it: a new day, a forecast change, or a new activity does not
  // change the athlete's words. The stored plan's timestamps describe the
  // inputs its last build already read, and an answered coach question can be
  // newer than the plan without touching the coaching-input timestamp.
  const shouldReadAthleteText = athleteTextChanged({
    planGeneratedAt: plan?.generatedAt ?? null,
    planAnswersUpdatedAt: plan?.answersUpdatedAt ?? null,
    planCoachingInputsUpdatedAt: plan?.coachingInputsUpdatedAt ?? null,
    answers,
    coachingInputsUpdatedAt: coachingInputs.updatedAt,
    coachAnswers,
  });

  if (shouldReadAthleteText) {
    // One reading covers the measurements, goals and events the athlete states
    // in their own words. Reading is a model task, not a phrase list.
    await (deps.syncAthleteReading ?? syncAthleteReading)({
      userId,
      today,
      source: buildAthleteReadingSource(
        {
          answers,
          activityComments: coachingInputs.activityComments,
          manualActivities: coachingInputs.manualActivities,
          weeklyNotes: coachingInputs.weeklyNotes ?? [],
          periodReviews: coachingInputs.periodReviews,
          coachQuestionAnswers: coachAnswers.map((answer) => ({
            question: answer.question,
            answer: answer.answer ?? "",
            answeredAt: answer.answeredAt,
          })),
        },
        today,
      ),
      provider: llm.provider,
      credentials: {
        apiKey: llm.apiKey,
        model: llm.model,
        signal: options.signal,
      },
    });
    if (
      options.signal.aborted ||
      !(await deps.generations.isCurrent(userId, options.runId))
    ) {
      throw new GenerationSupersededError();
    }
  }
  let events: Awaited<ReturnType<typeof loadAthleteEvents>>;
  try {
    events = await (deps.loadEvents ?? loadAthleteEvents)(userId);
  } catch (err) {
    // Events are advisory. A read failure must not stop the plan.
    console.error("[events] could not load the athlete's events:", err);
    events = [];
  }

  const diet = await (deps.loadDiet ?? loadDietContext)(userId, today);

  let calorieHistory: { date: string; caloriesKcal: number }[] | undefined;
  try {
    const targets = await loadPlanDayCalories(
      userId,
      addDays(today, -28),
      today,
    );
    calorieHistory = [...targets]
      .map(([date, caloriesKcal]) => ({ date, caloriesKcal }))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch (err) {
    // The earlier targets only help the coach judge the trend; the plan must
    // still generate when they cannot be read.
    console.error("[diet] could not read the calorie targets:", err);
    calorieHistory = undefined;
  }

  const thresholdHistory = await (
    deps.loadThresholdHistory ?? loadThresholdHistoryForUser
  )(userId, today);
  const bodyHistory = await (deps.loadBodyHistory ?? loadBodyHistoryForUser)(
    userId,
  );
  let dailyHealth: DailyHealthPoint[] | undefined;
  try {
    dailyHealth = await (deps.loadDailyHealth ?? loadDailyHealthForUser)(
      userId,
      addDays(today, -42),
      today,
    );
  } catch (err) {
    // Recovery data is advisory; the plan must still generate without it.
    console.error("[garmin] could not read daily health metrics:", err);
    dailyHealth = undefined;
  }
  let weatherForecasts: WeatherForecastSet | null = null;
  let forecast: DailyWeather[] | null = null;
  if (location !== null) {
    try {
      const loadForecast =
        deps.loadForecast ??
        ((entry: AthleteLocation, zone: string | null) =>
          fetchWeatherForecasts(entry, { timezone: zone }));
      weatherForecasts = await loadForecast(location, timeZone);
      forecast =
        weatherForecasts.combined.length > 0 ? weatherForecasts.combined : null;
    } catch (err) {
      // Weather is advisory. A forecast outage must not stop the plan.
      console.error("[weather] could not fetch the forecast:", err);
    }
  }

  // The caller owns the background task and heartbeat; the client polls GET
  // for progress while this long cascade runs.
  //
  // An analysis pass can begin after this run loaded its feed, for example
  // while the athlete-metrics and forecast phases run. Wait for it and use its
  // finished feed so the prompt never plans from an analysis that is about to
  // be replaced.
  const refreshedActivities = await latestActivityAnalysisSince(
    userId,
    activitiesSnapshotAt,
  );
  if (refreshedActivities !== null) {
    recentActivities = refreshedActivities.activities.slice(
      0,
      MAX_ANALYZED_ACTIVITIES,
    );
  }

  await runPlanGeneration({
    userId,
    runId: options.runId,
    signal: options.signal,
    today,
    ...(timezone !== undefined ? { timezone } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(force !== undefined ? { force } : {}),
    ...(includeTomorrow !== undefined ? { includeTomorrow } : {}),
    ...(keepToday !== undefined ? { keepToday } : {}),
    capturePeriodReviews: captureCompletedPeriodReviews,
    markPromptsFailed: deps.markPlanPromptsFailed ?? markPlanPromptsFailed,
    recordFtpEstimates: (generatedPlan) =>
      recordPlanFtpEstimates(userId, planFtpEstimates(generatedPlan)),
    recordBodyMetrics: (points) =>
      recordCoachBodyMetrics(userId, points, today),
    recordCoachQuestion: ({ question, model, sourceKind }) =>
      saveCoachQuestions({ userId, questions: [question], model, sourceKind }),
    clearCoachQuestions: () => clearPendingCoachQuestions(userId),
    plan,
    context: {
      answers,
      answersUpdatedAt: latestAnswerTimestamp(answers),
      activities: recentActivities,
      manualActivities: coachingInputs.manualActivities,
      activityComments: coachingInputs.activityComments,
      weeklyNote: coachingInputs.weeklyNote,
      weeklyNoteWeekStartDate: coachingInputs.weeklyNoteWeekStartDate,
      weeklyNoteReply: coachingInputs.weeklyNoteReply,
      weeklyNoteUpdatedAt: coachingInputs.weeklyNoteUpdatedAt,
      periodReviews: coachingInputs.periodReviews,
      weekReviewUpdatedAt: coachingInputs.weekReviewUpdatedAt,
      blockReviewUpdatedAt: coachingInputs.blockReviewUpdatedAt,
      coachingInputsUpdatedAt: coachingInputs.updatedAt,
      coachingInputsRefreshUpdatedAt: coachingInputs.refreshUpdatedAt,
      weekReviewNeedsRefresh: coachingInputs.weekReviewNeedsRefresh,
      blockReviewNeedsRefresh: coachingInputs.blockReviewNeedsRefresh,
      coachingSurveyAdjustments: surveyAdjustments.map((adjustment) => ({
        question: adjustment.question,
        previousQuestion: adjustment.previousQuestion,
        answer: adjustment.answer,
        previousAnswer: adjustment.previousAnswer,
      })),
      activitiesUpdatedAt: latestActivityAnalysisTimestamp(recentActivities),
      activitiesRefreshUpdatedAt:
        latestPlanChangingAnalysisTimestamp(recentActivities),
      timeZone,
      location,
      forecast,
      weatherForecasts,
      ftpHistory: ftpHistoryPoints(thresholdHistory.timelines),
      thresholds: thresholdHistory.summaries,
      thresholdTimelines: thresholdHistory.timelines,
      bodyHistory,
      ...(dailyHealth !== undefined ? { dailyHealth } : {}),
      events,
      ...(diet !== null ? { diet } : {}),
      dietGoal: plan?.plan.diet ?? null,
      dietAdvice: user?.dietAdvice ?? false,
      ...(calorieHistory !== undefined ? { calorieHistory } : {}),
      provider: llm.provider,
      apiKey: llm.apiKey,
      model: llm.model,
      ...(llm.seasonModel !== undefined
        ? { seasonModel: llm.seasonModel }
        : {}),
      ...(llm.dailyModel !== undefined ? { dailyModel: llm.dailyModel } : {}),
      signal: options.signal,
    },
    plans: deps.plans,
    generations: deps.generations,
    clearCoachingSurveyAdjustments: () =>
      surveyAdjustmentStore.clearForUser(userId),
  });
}
