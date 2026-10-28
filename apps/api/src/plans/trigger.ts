import type { ActivityFeed } from "../coaching/activities.js";
import {
  loadAnalyzedActivities,
  MAX_ACTIVITIES,
} from "../coaching/activities.js";
import { captureCompletedPeriodReviews } from "../coaching/periodReviews.js";
import { analyzeActivitiesAgainstPlan } from "../coaching/programAnalysis.js";
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
import { GENERATION_HEARTBEAT_MS } from "./generation.js";
import { runPlanGeneration } from "./generate.js";
import { planFtpEstimates } from "./generate.js";
import { loadCoachingInputs, type CoachingInputs } from "./inputs.js";
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
}

/**
 * Starts a plan generation in the background. Called by the explicit generate
 * route and by the routes that edit activity comments, manual activities, and
 * weekly notes, so an edit behaves like a fresh visit to the app. Returns false
 * when a generation is already running.
 */
export async function triggerPlanGeneration(
  deps: PlanTriggerDependencies,
  options: {
    userId: number;
    today: string;
    timezone?: string;
    mode?: PlanGenerateMode;
    force?: boolean;
    includeTomorrow?: boolean;
    /** Keep today's stored session while revising around a new input. */
    keepToday?: boolean;
  },
): Promise<boolean> {
  const { userId, today, timezone, mode, force, includeTomorrow, keepToday } =
    options;
  if (!(await deps.generations.begin(userId))) {
    return false;
  }

  // Keep the running row fresh from the moment it is claimed. Loading the
  // activities can itself take minutes, so it must not look like a dead run.
  const heartbeat = setInterval(() => {
    void deps.generations.heartbeat(userId).catch((err: unknown) => {
      console.error("[plan] could not refresh generation status:", err);
    });
  }, GENERATION_HEARTBEAT_MS);
  heartbeat.unref();

  let plan: Awaited<ReturnType<PlanStore["load"]>>;
  let answers: Awaited<ReturnType<QuestionAnswerStore["listForUser"]>>;
  let activities: ActivityFeed;
  let llm: LlmClient | null;
  let coachingInputs: CoachingInputs;
  let user: Awaited<ReturnType<UserStore["getById"]>>;

  try {
    [plan, answers, activities, llm, coachingInputs, user] = await Promise.all([
      deps.plans.load(userId),
      deps.answers.listForUser(userId),
      deps.loadActivities
        ? deps.loadActivities(userId)
        : loadAnalyzedActivities({
            userId,
            // The sidecar syncs 42 days. Use the largest feed the analysis cap
            // allows so ATL/CTL have as much history as possible.
            limit: MAX_ACTIVITIES,
            refresh: false,
          }),
      deps.loadLlm ? deps.loadLlm(userId) : loadLlmClient(userId),
      deps.loadCoachingInputs
        ? deps.loadCoachingInputs(userId, startOfWeek(today))
        : loadCoachingInputs(userId, startOfWeek(today)),
      deps.users.getById(userId),
    ]);
  } catch (err) {
    clearInterval(heartbeat);
    const message =
      err instanceof Error ? err.message : "The plan could not be generated.";
    await deps.generations.fail(userId, message);
    throw err;
  }

  if (!llm) {
    clearInterval(heartbeat);
    const message = "OpenRouter is not configured. Add a key and model first.";
    await deps.generations.fail(userId, message);
    return true;
  }

  const location = user?.location ?? null;
  const loadFtpHistory = deps.loadFtpHistory ?? loadFtpHistoryForUser;
  const ftp = await loadFtpHistory(
    userId,
    {
      answers,
      answersUpdatedAt: latestAnswerTimestamp(answers),
      manualActivities: coachingInputs.manualActivities,
      activityComments: coachingInputs.activityComments,
      weeklyNote: coachingInputs.weeklyNote,
      weeklyNoteUpdatedAt: coachingInputs.weeklyNoteUpdatedAt,
      periodReviews: coachingInputs.periodReviews,
    },
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

  // Run the long cascade after responding so the request cannot hit the server
  // idle timeout. The client polls GET for progress.
  void runPlanGeneration({
    userId,
    today,
    ...(timezone !== undefined ? { timezone } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(force !== undefined ? { force } : {}),
    ...(includeTomorrow !== undefined ? { includeTomorrow } : {}),
    ...(keepToday !== undefined ? { keepToday } : {}),
    capturePeriodReviews: captureCompletedPeriodReviews,
    recordFtpEstimates: (generatedPlan) =>
      recordPlanFtpEstimates(userId, planFtpEstimates(generatedPlan)),
    recordBodyMetrics: (points) =>
      recordCoachBodyMetrics(userId, points, today),
    reviewActivities: (plan) =>
      analyzeActivitiesAgainstPlan({
        userId,
        provider: llm.provider,
        apiKey: llm.apiKey,
        model: llm.model,
        today,
        plan,
        activities: activities.activities,
        activityComments: coachingInputs.activityComments,
        ftpHistory: ftp.points.filter((point) => point.date <= today),
        ftpTimeline: ftp.timeline,
      }),
    plan,
    context: {
      answers,
      answersUpdatedAt: latestAnswerTimestamp(answers),
      activities: activities.activities,
      manualActivities: coachingInputs.manualActivities,
      activityComments: coachingInputs.activityComments,
      weeklyNote: coachingInputs.weeklyNote,
      weeklyNoteUpdatedAt: coachingInputs.weeklyNoteUpdatedAt,
      periodReviews: coachingInputs.periodReviews,
      coachingInputsUpdatedAt: coachingInputs.updatedAt,
      activitiesUpdatedAt: latestActivityAnalysisTimestamp(
        activities.activities,
      ),
      location,
      forecast,
      weatherForecasts,
      ftpTimeline: ftp.timeline,
      ftpHistory: ftp.points.filter((point) => point.date <= today),
      bodyHistory,
      provider: llm.provider,
      apiKey: llm.apiKey,
      model: llm.model,
    },
    plans: deps.plans,
    generations: deps.generations,
  })
    .catch((err: unknown) => {
      console.error("[plan] background generation failed:", err);
    })
    .finally(() => clearInterval(heartbeat));

  return true;
}
