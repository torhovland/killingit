import {
  coachPlanResponseSchema,
  coachPlanSchema,
  hasExportableBikeWorkout,
  planDateSchema,
  planGenerateInputSchema,
  type AthleteLocation,
  type BikeWorkout,
  type CoachPlan,
} from "@killingit/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getAthlete } from "../auth/middleware.js";
import type { ActivityFeed } from "../coaching/activities.js";
import { markPlanPromptsFailed } from "../llm/callStore.js";
import type { LlmClient } from "../llm/client.js";
import { startOfWeek } from "../plans/dates.js";
import { isStaleRunning, MAX_AUTO_RETRIES } from "../plans/generation.js";
import { loadCoachingInputs, type CoachingInputs } from "../plans/inputs.js";
import { promoteNextPeriod, weekFor } from "../plans/periods.js";
import {
  latestAnswerTimestamp,
  planIsStale,
  planPending,
} from "../plans/status.js";
import type { PlanGenerationStore, PlanStore } from "../plans/store.js";
import {
  startClaimedPlanGeneration,
  triggerPlanGeneration,
  type PlanTriggerDependencies,
} from "../plans/trigger.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import type { UserStore } from "../users/store.js";
import { planWeatherChanged } from "../weather/changes.js";
import { fetchWeatherForecasts } from "../weather/forecast.js";
import { buildZwoWorkout, zwoFilename } from "../workouts/zwo.js";

/** The parts of a session needed to build a trainer workout file. */
interface ExportableBikeWorkout {
  title: string;
  description: string;
  bikeWorkout: BikeWorkout;
}

/**
 * Finds the indoor bike workout for a date. Today and tomorrow come from the
 * day plans so the download matches the Day tab; other dates fall back to the
 * stored week (including next week after 18:00).
 */
function findExportableBikeWorkout(
  plan: CoachPlan,
  date: string,
): ExportableBikeWorkout | null {
  const day =
    plan.today.date === date
      ? plan.today
      : plan.tomorrow !== null && plan.tomorrow.date === date
        ? plan.tomorrow
        : null;
  if (day !== null) {
    return hasExportableBikeWorkout(day)
      ? {
          title: day.title,
          description: day.description,
          bikeWorkout: day.bikeWorkout,
        }
      : null;
  }

  const session = weekFor(plan, date)?.sessions.find(
    (entry) => entry.date === date,
  );
  if (session === undefined || !hasExportableBikeWorkout(session)) {
    return null;
  }
  return {
    title: session.title,
    description: session.description,
    bikeWorkout: session.bikeWorkout,
  };
}

/** What a stale-run retry needs to restart for the same athlete and day. */
export interface PlanRetryInput {
  userId: number;
  today: string;
  timezone: string | null;
  includeTomorrow: boolean;
}

export interface PlanRouteDependencies {
  users: UserStore;
  answers: QuestionAnswerStore;
  plans: PlanStore;
  generations: PlanGenerationStore;
  /** Injectable for route tests; defaults to a Garmin sync. */
  loadActivities?: (userId: number) => Promise<ActivityFeed>;
  /** Injectable for route tests; defaults to the stored FTP time series. */
  loadFtpHistory?: PlanTriggerDependencies["loadFtpHistory"];
  /** Injectable for route tests; defaults to the stored body metrics. */
  loadBodyHistory?: PlanTriggerDependencies["loadBodyHistory"];
  /** Injectable for route tests; defaults to the metrics reader. */
  syncAthleteMetrics?: PlanTriggerDependencies["syncAthleteMetrics"];
  /** Injectable for route tests; defaults to the account's stored config. */
  loadLlm?: (userId: number) => Promise<LlmClient | null>;
  /** Injectable for route tests; defaults to the database-backed loader. */
  loadCoachingInputs?: (
    userId: number,
    weekStartDate: string,
  ) => Promise<CoachingInputs>;
  /** Injectable for route tests; defaults to Open-Meteo and Yr. */
  loadForecast?: PlanTriggerDependencies["loadForecast"];
  /** Injectable for route tests; defaults to the prompt-log writer. */
  markPlanPromptsFailed?: PlanTriggerDependencies["markPlanPromptsFailed"];
  /** Injectable for route tests; defaults to claiming a retry and starting it. */
  retryGeneration?: (input: PlanRetryInput) => Promise<boolean>;
}

/**
 * Coach plan routes. GET reads the stored plan and reports what is missing for
 * the supplied date. POST runs the generation cascade; the UI calls it without
 * awaiting the response and polls GET for progress.
 */
export function createPlanRoute(deps: PlanRouteDependencies): Hono {
  /** The trigger dependencies shared by the POST and the automatic retry. */
  function planTriggerDependencies(): PlanTriggerDependencies {
    return {
      users: deps.users,
      answers: deps.answers,
      plans: deps.plans,
      generations: deps.generations,
      ...(deps.loadActivities !== undefined
        ? { loadActivities: deps.loadActivities }
        : {}),
      ...(deps.loadFtpHistory !== undefined
        ? { loadFtpHistory: deps.loadFtpHistory }
        : {}),
      ...(deps.loadBodyHistory !== undefined
        ? { loadBodyHistory: deps.loadBodyHistory }
        : {}),
      ...(deps.syncAthleteMetrics !== undefined
        ? { syncAthleteMetrics: deps.syncAthleteMetrics }
        : {}),
      ...(deps.loadLlm !== undefined ? { loadLlm: deps.loadLlm } : {}),
      ...(deps.loadCoachingInputs !== undefined
        ? { loadCoachingInputs: deps.loadCoachingInputs }
        : {}),
      ...(deps.loadForecast !== undefined
        ? { loadForecast: deps.loadForecast }
        : {}),
      ...(deps.markPlanPromptsFailed !== undefined
        ? { markPlanPromptsFailed: deps.markPlanPromptsFailed }
        : {}),
    };
  }

  /**
   * Claims the one automatic retry of a stale run, then loads its inputs in
   * the background so the polling GET can answer immediately. Returns false
   * when another request already started a run.
   */
  async function retryStaleGeneration(input: PlanRetryInput): Promise<boolean> {
    if (!(await deps.generations.begin(input.userId, { retry: true }))) {
      return false;
    }
    void startClaimedPlanGeneration(planTriggerDependencies(), {
      userId: input.userId,
      today: input.today,
      ...(input.timezone !== null ? { timezone: input.timezone } : {}),
      ...(input.includeTomorrow ? { includeTomorrow: true } : {}),
    }).catch((err: unknown) => {
      console.error("[plan] automatic retry failed to start:", err);
    });
    return true;
  }

  const retryGeneration = deps.retryGeneration ?? retryStaleGeneration;

  async function hasWeatherChanged(
    plan: CoachPlan,
    location: AthleteLocation,
    today: string,
    timezone: string | null,
  ): Promise<boolean> {
    try {
      const loadForecast =
        deps.loadForecast ??
        ((target: AthleteLocation, zone: string | null) =>
          fetchWeatherForecasts(target, { timezone: zone }));
      const { combined } = await loadForecast(location, timezone);
      return planWeatherChanged(plan, combined, today);
    } catch (err) {
      // Weather is advisory. An outage must not make the plan look pending or
      // fail the request.
      console.error("[weather] could not check the forecast:", err);
      return false;
    }
  }

  async function buildResponse(
    userId: number,
    location: AthleteLocation | null,
    timezone: string | null,
    today: string,
    includeTomorrow = false,
  ) {
    const [storedPlan, loadedGeneration, answers, coachingInputs] =
      await Promise.all([
        deps.plans.load(userId),
        deps.generations.load(userId),
        deps.answers.listForUser(userId),
        deps.loadCoachingInputs
          ? deps.loadCoachingInputs(userId, startOfWeek(today))
          : loadCoachingInputs(userId, startOfWeek(today)),
      ]);
    // A process that stopped mid-generation leaves the row `running`. Release
    // the claim so the client stops polling and can start a fresh run. Pass the
    // heartbeat we observed: a run that refreshed itself after this read, or
    // one that replaced it, must stay untouched.
    let generation = loadedGeneration;
    if (isStaleRunning(generation)) {
      const message = "The coach stopped before finishing. Try again.";
      const failed = await deps.generations.fail(
        userId,
        message,
        generation.updatedAt,
      );
      if (failed !== null) {
        await (deps.markPlanPromptsFailed ?? markPlanPromptsFailed)(
          userId,
          failed.startedAt,
          message,
        );
        // Hide a single process death behind a fresh run. A second stale run
        // in the same chain keeps the error and lets the athlete decide.
        if (failed.autoRetries < MAX_AUTO_RETRIES) {
          await retryGeneration({
            userId,
            today,
            timezone,
            includeTomorrow,
          });
        }
      }
      generation = await deps.generations.load(userId);
    }
    const answersUpdatedAt = latestAnswerTimestamp(answers);

    // A plan saved under an older schema (or a partial write) must not crash
    // the endpoint. Treat it as absent so the client can regenerate it.
    const parsed = storedPlan
      ? coachPlanSchema.safeParse(storedPlan.plan)
      : null;
    const stored = parsed?.success ? parsed.data : null;
    // Show a next week or block as current once today has reached it, even
    // before the background promotion has been persisted.
    const plan = stored === null ? null : promoteNextPeriod(stored, today);
    const generatedAt =
      storedPlan && parsed?.success
        ? storedPlan.generatedAt.toISOString()
        : null;
    const stale =
      storedPlan && parsed?.success
        ? planIsStale(storedPlan.answersUpdatedAt, answersUpdatedAt) ||
          planIsStale(
            storedPlan.coachingInputsUpdatedAt,
            coachingInputs.updatedAt,
          )
        : false;
    // A generated week review or an answer to one revises the block, even while
    // today is still inside the stored block's dates.
    const weekReviewPending =
      storedPlan && parsed?.success
        ? planIsStale(
            storedPlan.coachingInputsUpdatedAt,
            coachingInputs.weekReviewUpdatedAt,
          )
        : false;
    // A significantly different forecast should refresh the Week tab even when
    // the stored plan is otherwise current. Skip while a generation is running:
    // the client is polling, and the finished response checks the saved plan.
    const weatherChanged =
      plan !== null && location !== null && generation.status !== "running"
        ? await hasWeatherChanged(plan, location, today, timezone)
        : false;

    return coachPlanResponseSchema.parse({
      plan,
      generatedAt,
      generation,
      stale,
      pending: planPending(
        stored,
        today,
        includeTomorrow,
        weatherChanged,
        weekReviewPending,
      ),
    });
  }

  return new Hono()
    .get("/", async (c) => {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const today = planDateSchema.safeParse(c.req.query("today"));
      if (!today.success) {
        return c.text("A valid today date (YYYY-MM-DD) is required", 400);
      }
      const includeTomorrow = c.req.query("includeTomorrow") === "true";
      return c.json(
        await buildResponse(
          user.id,
          user.location,
          user.timezone,
          today.data,
          includeTomorrow,
        ),
      );
    })
    .get("/workouts/:date", async (c) => {
      const date = planDateSchema.safeParse(c.req.param("date"));
      if (!date.success) {
        return c.text("A valid date (YYYY-MM-DD) is required", 400);
      }
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const stored = await deps.plans.load(user.id);
      const parsed =
        stored === null ? null : coachPlanSchema.safeParse(stored.plan);
      if (parsed === null || !parsed.success) {
        return c.text("No coach plan is available", 404);
      }
      const workout = findExportableBikeWorkout(parsed.data, date.data);
      if (workout === null) {
        return c.text("No downloadable bike workout for that date", 404);
      }
      return c.body(
        buildZwoWorkout({
          title: workout.title,
          description: workout.description,
          workout: workout.bikeWorkout,
        }),
        200,
        {
          "content-type": "application/xml; charset=utf-8",
          "content-disposition": `attachment; filename="${zwoFilename(date.data, workout.title)}"`,
          "cache-control": "no-store",
        },
      );
    })
    .post(
      "/generate",
      zValidator("json", planGenerateInputSchema),
      async (c) => {
        const user = await deps.users.ensureUser(getAthlete(c).sub);
        const { today, timezone, mode, force, includeTomorrow } =
          c.req.valid("json");

        const started = await triggerPlanGeneration(planTriggerDependencies(), {
          userId: user.id,
          today,
          ...(timezone !== undefined ? { timezone } : {}),
          mode,
          force,
          includeTomorrow,
        });

        if (!started) {
          return c.json(
            await buildResponse(user.id, user.location, user.timezone, today),
            202,
          );
        }

        return c.json(
          await buildResponse(
            user.id,
            user.location,
            user.timezone,
            today,
            includeTomorrow,
          ),
          202,
        );
      },
    );
}
