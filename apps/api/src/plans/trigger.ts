import type { ActivityFeed } from "../coaching/activities.js";
import { loadAnalyzedActivities } from "../coaching/activities.js";
import { MAX_ANALYZED_ACTIVITIES } from "../coaching/feedCache.js";
import {
  buildAthleteMetricSource,
  syncAthleteMetrics,
} from "../coaching/athleteMetrics.js";
import { captureCompletedPeriodReviews } from "../coaching/periodReviews.js";
import { analyzeActivitiesAgainstPlan } from "../coaching/programAnalysis.js";
import { markPlanPromptsFailed } from "../llm/callStore.js";
import type { LlmClient } from "../llm/client.js";
import { loadLlmClient } from "../llm/client.js";
import {
  loadBodyHistoryForUser,
  loadFtpHistoryForUser,
  recordCoachBodyMetrics,
  recordPlanFtpEstimates,
} from "../metrics/store.js";
import type {
  AthleteLocation,
  DailyWeather,
  PlanGenerateMode,
} from "@killingit/shared";
import type { QuestionAnswerStore } from "../questions/answers.js";
import type { UserStore } from "../users/store.js";
import {
  fetchWeatherForecasts,
  type WeatherForecastSet,
} from "../weather/forecast.js";
import { startOfWeek } from "./dates.js";
import {
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
import { loadCoachingInputs, type CoachingInputs } from "./inputs.js";
import { claimRun, releaseRun } from "./runs.js";
import {
  latestActivityAnalysisTimestamp,
  latestAnswerTimestamp,
} from "./status.js";
import type { PlanGenerationStore, PlanStore } from "./store.js";

export interface PlanTriggerDependencies {
  users: UserStore;
  answers: QuestionAnswerStore;
  plans: PlanStore;
  generations: PlanGenerationStore;
  /** Injectable for route tests; defaults to a Garmin sync. */
  loadActivities?: (userId: number) => Promise<ActivityFeed>;
  /** Injectable for route tests; defaults to the stored FTP time series. */
  loadFtpHistory?: typeof loadFtpHistoryForUser;
  /** Injectable for route tests; defaults to the stored body metrics. */
  loadBodyHistory?: typeof loadBodyHistoryForUser;
  /** Injectable for route tests; defaults to the coach reading the text. */
  syncAthleteMetrics?: typeof syncAthleteMetrics;
  /** Injectable for route tests; defaults to answered coach questions. */
  loadAnsweredCoachQuestions?: typeof loadAnsweredCoachQuestions;
  /** Injectable for route tests; defaults to the account's stored config. */
  loadLlm?: (userId: number) => Promise<LlmClient | null>;
  /** Injectable for route tests; defaults to the database-backed loader. */
  loadCoachingInputs?: (
    userId: number,
    weekStartDate: string,
  ) => Promise<CoachingInputs>;
  /** Injectable for tests; defaults to Open-Meteo and Yr.no. */
  loadForecast?: (
    location: AthleteLocation,
    timezone: string | null,
  ) => Promise<WeatherForecastSet>;
  /** Injectable for tests; defaults to the prompt-log writer. */
  markPlanPromptsFailed?: typeof markPlanPromptsFailed;
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
 * Starts a plan generation in the background. The newest request always owns
 * the run: an older run is aborted and its writes are fenced by the run id.
 */
export async function triggerPlanGeneration(
  deps: PlanTriggerDependencies,
  options: PlanRunOptions,
): Promise<boolean> {
  const run = claimRun(options.userId);
  await deps.generations.begin(options.userId, run.runId);
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
  return true;
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
  const { userId, today, timezone, mode, force, includeTomorrow, keepToday } =
    options;

  let plan: Awaited<ReturnType<PlanStore["load"]>>;
  let answers: Awaited<ReturnType<QuestionAnswerStore["listForUser"]>>;
  let activities: ActivityFeed;
  let llm: LlmClient | null;
  let coachingInputs: CoachingInputs;
  let user: Awaited<ReturnType<UserStore["getById"]>>;
  let coachAnswers: Awaited<ReturnType<typeof loadAnsweredCoachQuestions>>;

  try {
    [plan, answers, activities, llm, coachingInputs, user, coachAnswers] =
      await Promise.all([
        deps.plans.load(userId),
        deps.answers.listForUser(userId),
        deps.loadActivities
          ? deps.loadActivities(userId)
          : loadAnalyzedActivities({
              userId,
              // The sidecar syncs 42 days. Analyse the newest activities the
              // cap allows; the plan prompt reviews the same recent window.
              limit: MAX_ANALYZED_ACTIVITIES,
              refresh: false,
            }),
        deps.loadLlm ? deps.loadLlm(userId) : loadLlmClient(userId, "all"),
        deps.loadCoachingInputs
          ? deps.loadCoachingInputs(userId, startOfWeek(today))
          : loadCoachingInputs(userId, startOfWeek(today)),
        deps.users.getById(userId),
        (deps.loadAnsweredCoachQuestions ?? loadAnsweredCoachQuestions)(userId),
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

  // The stored feed keeps every activity ever synced. Prompts and program
  // reviews stay on the same recent window as the analysis cap so they do not
  // grow with the athlete's entire history.
  const recentActivities = activities.activities.slice(
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

  // The coach reads the athlete's own words for a stated FTP, weight, and body
  // fat before the plan is generated, so every prompt and the TSS maths use the
  // newest numbers. Reading is a model task, not a phrase list. A generation is
  // only requested when a level is missing or an input changed, so this costs
  // one small call per real generation.
  await (deps.syncAthleteMetrics ?? syncAthleteMetrics)({
    userId,
    today,
    source: buildAthleteMetricSource(
      {
        answers,
        activityComments: coachingInputs.activityComments,
        manualActivities: coachingInputs.manualActivities,
        weeklyNote: coachingInputs.weeklyNote,
        weeklyNoteUpdatedAt: coachingInputs.weeklyNoteUpdatedAt,
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

  const ftp = await (deps.loadFtpHistory ?? loadFtpHistoryForUser)(
    userId,
    today,
  );
  const bodyHistory = await (deps.loadBodyHistory ?? loadBodyHistoryForUser)(
    userId,
  );
  let weatherForecasts: WeatherForecastSet | null = null;
  let forecast: DailyWeather[] | null = null;
  if (location !== null) {
    try {
      const loadForecast =
        deps.loadForecast ??
        ((entry: AthleteLocation, zone: string | null) =>
          fetchWeatherForecasts(entry, { timezone: zone }));
      weatherForecasts = await loadForecast(
        location,
        timezone ?? user?.timezone ?? null,
      );
      forecast =
        weatherForecasts.combined.length > 0 ? weatherForecasts.combined : null;
    } catch (err) {
      // Weather is advisory. A forecast outage must not stop the plan.
      console.error("[weather] could not fetch the forecast:", err);
    }
  }

  // The caller owns the background task and heartbeat; the client polls GET
  // for progress while this long cascade runs.
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
    recordCoachQuestions: ({ questions, model, sourceKind }) =>
      saveCoachQuestions({ userId, questions, model, sourceKind }),
    reviewActivities: (plan) =>
      analyzeActivitiesAgainstPlan({
        userId,
        provider: llm.provider,
        apiKey: llm.apiKey,
        model: llm.model,
        today,
        plan,
        activities: recentActivities,
        activityComments: coachingInputs.activityComments,
        ftpHistory: ftp.points.filter((point) => point.date <= today),
        ftpTimeline: ftp.timeline,
        thresholds: ftp.summaries,
        signal: options.signal,
      }),
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
      activitiesUpdatedAt: latestActivityAnalysisTimestamp(recentActivities),
      location,
      forecast,
      weatherForecasts,
      ftpTimeline: ftp.timeline,
      ftpHistory: ftp.points.filter((point) => point.date <= today),
      thresholds: ftp.summaries,
      thresholdTimelines: ftp.thresholdTimelines,
      bodyHistory,
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
  });
}
