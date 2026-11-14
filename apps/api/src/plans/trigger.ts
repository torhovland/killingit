import type { ActivityFeed } from "../coaching/feed/presenter.js";
import { latestActivityAnalysisSince } from "../coaching/analysisRuns.js";
import { MAX_ANALYZED_ACTIVITIES } from "../coaching/activityStore.js";
import {
  buildAthleteReadingSource,
  syncAthleteReading,
} from "../coaching/athleteReading.js";
import { loadAthleteEvents } from "../events/store.js";
import { loadDietContext } from "../diet/context.js";
import { captureCompletedPeriodReviews } from "../coaching/periodReviews.js";
import { markPlanPromptsFailed } from "../llm/callStore.js";
import type { LlmClient } from "../llm/client.js";
import {
  loadBodyHistoryForUser,
  loadThresholdHistoryForUser,
  recordCoachBodyMetrics,
  recordPlanFtpEstimates,
} from "../metrics/store.js";
import { loadDailyHealthForUser } from "../metrics/dailyMetrics.js";
import {
  addDays,
  type AthleteEvent,
  type AthleteLocation,
  type DailyHealthPoint,
  type DailyWeather,
  type PlanGenerateMode,
} from "@killingit/shared";
import type { QuestionAnswerStore } from "../questions/answers.js";
import type { CoachingSurveyAdjustmentStore } from "../questions/adjustments.js";
import type { UserStore } from "../users/store.js";
import {
  fetchWeatherForecasts,
  type WeatherForecastSet,
} from "../weather/forecast.js";
import { ftpHistoryPoints } from "../training/thresholds.js";
import { RecentTimestampMap } from "../lib/boundedMap.js";
import { isAfterPlanTomorrowCutoff } from "./dates.js";
import {
  clearPendingCoachQuestions,
  saveCoachQuestions,
} from "./coachQuestions.js";
import type { loadAnsweredCoachQuestions } from "./coachQuestions.js";
import {
  GENERATION_HEARTBEAT_MS,
  GenerationSupersededError,
  isGenerationSuperseded,
} from "./generation.js";
import { planFailureMessage } from "./failure.js";
import { loadPlanGenerationContext } from "./generationContext.js";
import { runPlanGeneration } from "./generate.js";
import { planFtpEstimates } from "../metrics/planFtpEstimates.js";
import type { PlanGenerationContext } from "./generation/types.js";
import { loadPlanDayCalories } from "./dayCalories.js";
import type { CoachingInputs } from "./inputs.js";
import { claimRun, releaseRun } from "./runs.js";
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
  /** Injectable for tests; defaults to the stored calorie targets. */
  loadDayCalories?: typeof loadPlanDayCalories | undefined;
  /** Injectable for tests; defaults to waiting for a newer analysis pass. */
  latestActivityAnalysisSince?: typeof latestActivityAnalysisSince | undefined;
  /** Injectable for tests; defaults to the database-backed review writer. */
  capturePeriodReviews?: typeof captureCompletedPeriodReviews | undefined;
  /** Injectable for tests; defaults to the stored FTP estimate writer. */
  recordFtpEstimates?: typeof recordPlanFtpEstimates | undefined;
  /** Injectable for tests; defaults to the stored body-metric writer. */
  recordBodyMetrics?: typeof recordCoachBodyMetrics | undefined;
  /** Injectable for tests; defaults to the stored coach-question writer. */
  saveCoachQuestions?: typeof saveCoachQuestions | undefined;
  /** Injectable for tests; defaults to clearing the pending coach question. */
  clearPendingCoachQuestions?: typeof clearPendingCoachQuestions | undefined;
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

/** The threshold history a plan prompt reads, as the store returns it. */
type ThresholdHistory = Awaited<ReturnType<typeof loadThresholdHistoryForUser>>;

/** The body weight and body-fat history a plan prompt reads. */
type BodyHistory = Awaited<ReturnType<typeof loadBodyHistoryForUser>>;

/** The coach's earlier calorie targets, newest first. */
type CalorieHistory = NonNullable<PlanGenerationContext["calorieHistory"]>;

/**
 * Triggers waiting for their debounce window to close. A timer removes its own
 * entry, and a newer trigger replaces an older one, so the map only holds
 * accounts triggered inside the current window. It is process-local: a second
 * instance debounces its own requests but shares the database run fence.
 */
const pendingStarts = new Map<number, PendingPlanStart>();

/**
 * The last trigger time per account, pruned to the current debounce window.
 * An older time cannot affect a wait calculation, so it is dropped instead of
 * kept for every account that ever generated a plan. Process-local: on
 * scale-out each instance debounces the requests it happens to receive.
 */
const lastTriggerAt = new RecentTimestampMap();

/** The threshold history used when the stored values cannot be read. */
const EMPTY_THRESHOLD_HISTORY: ThresholdHistory = {
  points: [],
  timelines: [],
  summaries: [],
};

/** The body history used when the stored measurements cannot be read. */
const EMPTY_BODY_HISTORY: BodyHistory = { weight: [], bodyFat: [] };

/** How far back a plan prompt reads the coach's earlier calorie targets. */
const CALORIE_HISTORY_DAYS = 28;

/** How far back a plan prompt reads the daily health and recovery series. */
const DAILY_HEALTH_HISTORY_DAYS = 42;

/**
 * Starts a plan generation in the background. The newest request always owns
 * the run: an older run is aborted and its writes are fenced by the run id.
 */
export async function triggerPlanGeneration(
  deps: PlanTriggerDependencies,
  options: PlanRunOptions,
): Promise<boolean> {
  const run = claimRun(options.userId);
  try {
    await deps.generations.begin(options.userId, run.runId);
  } catch (err) {
    // The claim must not outlive a run that never started, or the registry
    // would keep one entry per account whose begin failed.
    releaseRun(options.userId, run.runId);
    throw err;
  }

  const pending = pendingStarts.get(options.userId);
  if (pending !== undefined) {
    clearTimeout(pending.timer);
    pendingStarts.delete(options.userId);
  }

  const now = Date.now();
  const explicit =
    options.mode === "newSeason" ||
    options.mode === "updateSeason" ||
    options.force === true;
  const debounceMs = deps.planTriggerDebounceMs ?? PLAN_TRIGGER_DEBOUNCE_MS;
  const previousAt = lastTriggerAt.record(options.userId, now, debounceMs);
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
    .catch(async (err: unknown) => {
      if (isGenerationSuperseded(err)) {
        return;
      }
      console.error("[plan] background generation failed:", err);
      // The loading phase fails the row itself and rethrows. A later phase
      // throws without doing so, so this catch covers the whole run. Failing
      // an already-failed row is a no-op. The reason is athlete-facing, and the
      // raw failure is logged above. See ADR 0038.
      try {
        await deps.generations.fail(
          options.userId,
          planFailureMessage(err),
          run.runId,
        );
      } catch (failure: unknown) {
        console.error("[plan] could not mark generation failed:", failure);
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
 * Reads one advisory plan input. Every prompt input a run reads after the
 * account's own state is advisory: an unavailable events, diet, metrics,
 * calorie or weather source is logged and the coach plans without it, because
 * a plan from a thinner picture is better than no plan at all. Only the inputs
 * `loadPlanGenerationContext` reads are required.
 */
async function attempt<T>(
  label: string,
  read: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await read();
  } catch (err) {
    console.error(
      `[plan] could not read the ${label}; planning without it:`,
      err,
    );
    return fallback;
  }
}

/**
 * Reads every advisory prompt input a plan run enriches its prompts with. One
 * function owns the list and the fail-open policy, so a new input is declared
 * here instead of growing a bespoke `try`/`catch` at its call site.
 */
async function loadPlanInputs(
  deps: PlanTriggerDependencies,
  options: {
    userId: number;
    today: string;
    location: AthleteLocation | null;
    timeZone: string | null;
  },
): Promise<{
  events: AthleteEvent[];
  diet: Awaited<ReturnType<typeof loadDietContext>>;
  calorieHistory: CalorieHistory | undefined;
  thresholdHistory: ThresholdHistory;
  bodyHistory: BodyHistory;
  dailyHealth: DailyHealthPoint[] | undefined;
  weatherForecasts: WeatherForecastSet | null;
  forecast: DailyWeather[] | null;
}> {
  const { userId, today, location, timeZone } = options;
  const loadDayCalories = deps.loadDayCalories ?? loadPlanDayCalories;

  const [
    events,
    diet,
    calorieHistory,
    thresholdHistory,
    bodyHistory,
    dailyHealth,
    weather,
  ] = await Promise.all([
    attempt<AthleteEvent[]>(
      "athlete's events",
      () => (deps.loadEvents ?? loadAthleteEvents)(userId),
      [],
    ),
    attempt<Awaited<ReturnType<typeof loadDietContext>>>(
      "diet log",
      () => (deps.loadDiet ?? loadDietContext)(userId, today),
      null,
    ),
    attempt<CalorieHistory | undefined>(
      "earlier calorie targets",
      async () => {
        const targets = await loadDayCalories(
          userId,
          addDays(today, -CALORIE_HISTORY_DAYS),
          today,
        );
        return [...targets]
          .map(([date, caloriesKcal]) => ({ date, caloriesKcal }))
          .sort((a, b) => b.date.localeCompare(a.date));
      },
      undefined,
    ),
    attempt<ThresholdHistory>(
      "threshold history",
      () =>
        (deps.loadThresholdHistory ?? loadThresholdHistoryForUser)(
          userId,
          today,
        ),
      EMPTY_THRESHOLD_HISTORY,
    ),
    attempt<BodyHistory>(
      "body history",
      () => (deps.loadBodyHistory ?? loadBodyHistoryForUser)(userId),
      EMPTY_BODY_HISTORY,
    ),
    attempt<DailyHealthPoint[] | undefined>(
      "daily health metrics",
      () =>
        (deps.loadDailyHealth ?? loadDailyHealthForUser)(
          userId,
          addDays(today, -DAILY_HEALTH_HISTORY_DAYS),
          today,
        ),
      undefined,
    ),
    location === null
      ? null
      : attempt<WeatherForecastSet | null>(
          "weather forecast",
          () =>
            (
              deps.loadForecast ??
              ((entry: AthleteLocation, zone: string | null) =>
                fetchWeatherForecasts(entry, { timezone: zone }))
            )(location, timeZone),
          null,
        ),
  ]);

  return {
    events,
    diet,
    calorieHistory,
    thresholdHistory,
    bodyHistory,
    dailyHealth,
    weatherForecasts: weather,
    forecast:
      weather !== null && weather.combined.length > 0 ? weather.combined : null,
  };
}

/**
 * Loads one run's context and executes it. The caller has already claimed the
 * generation row and owns the heartbeat, so this can run after an optional
 * reply phase in the same run.
 */
export async function runPlanForUser(
  deps: PlanTriggerDependencies,
  options: PlanRunOptions & { runId: string; signal: AbortSignal },
): Promise<void> {
  const { userId, today, timezone, mode, force, keepToday } = options;

  const loaded = await loadPlanGenerationContext(deps, options);
  if (loaded === null) {
    // The account has no model; the row already carries the reason.
    return;
  }
  const {
    plan,
    answers,
    activities,
    llm,
    coachingInputs,
    user,
    coachAnswers,
    surveyAdjustments,
    surveyAdjustmentStore,
    activitiesSnapshotAt,
  } = loaded;

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
  const {
    events,
    diet,
    calorieHistory,
    thresholdHistory,
    bodyHistory,
    dailyHealth,
    weatherForecasts,
    forecast,
  } = await loadPlanInputs(deps, { userId, today, location, timeZone });

  // The caller owns the background task and heartbeat; the client polls GET
  // for progress while this long cascade runs.
  //
  // An analysis pass can begin after this run loaded its feed, for example
  // while the athlete-metrics and forecast phases run. Wait for it and use its
  // finished feed so the prompt never plans from an analysis that is about to
  // be replaced.
  const refreshedActivities = await (
    deps.latestActivityAnalysisSince ?? latestActivityAnalysisSince
  )(userId, today, activitiesSnapshotAt);
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
    capturePeriodReviews:
      deps.capturePeriodReviews ?? captureCompletedPeriodReviews,
    markPromptsFailed: deps.markPlanPromptsFailed ?? markPlanPromptsFailed,
    recordFtpEstimates: (generatedPlan) =>
      (deps.recordFtpEstimates ?? recordPlanFtpEstimates)(
        userId,
        planFtpEstimates(generatedPlan),
      ),
    recordBodyMetrics: (points) =>
      (deps.recordBodyMetrics ?? recordCoachBodyMetrics)(userId, points, today),
    recordCoachQuestion: ({ question, model, sourceKind }) =>
      (deps.saveCoachQuestions ?? saveCoachQuestions)({
        userId,
        questions: [question],
        model,
        sourceKind,
      }),
    clearCoachQuestions: () =>
      (deps.clearPendingCoachQuestions ?? clearPendingCoachQuestions)(userId),
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
      surveyAdjustmentStore.clearConsumed(
        userId,
        surveyAdjustments.map((adjustment) => adjustment.id),
      ),
  });
}
