import {
  coachPlanResponseSchema,
  hasExportableBikeWorkout,
  planDateSchema,
  planGenerateInputSchema,
  type AthleteLocation,
  type BikeWorkout,
  type CoachPlan,
} from "@killingit/shared";
import { zValidator } from "../http/validation.js";
import { Hono } from "hono";
import { z } from "zod";
import { getUser } from "../auth/middleware.js";
import { notFound, validationFailed } from "../http/errors.js";
import {
  planTriggerDependencies,
  type ResolvedAppDependencies,
} from "../dependencies.js";
import { loadAthleteEvents } from "../events/store.js";
import { markPlanPromptsFailed } from "../llm/callStore.js";
import { loadThresholdHistoryForUser } from "../metrics/store.js";
import { startOfWeek } from "@killingit/shared";
import { isStaleRunning } from "../plans/generation.js";
import { loadCoachingInputs } from "../plans/inputs.js";
import { promoteNextPeriod, weekFor } from "../plans/periods.js";
import {
  latestAnswerTimestamp,
  planIsStale,
  planPending,
} from "../plans/status.js";
import { loadValidatedPlan } from "../plans/store.js";
import { triggerPlanGeneration } from "../plans/trigger.js";
import { planWeatherChanged } from "../weather/changes.js";
import { fetchWeatherForecasts } from "../weather/forecast.js";
import { buildZwoWorkout, zwoFilename } from "../workouts/zwo.js";

/** The date of the workout file the athlete downloads. */
const workoutDateParamSchema = z.object({ date: planDateSchema });

/** The parts of a session needed to build a trainer workout file. */
interface ExportableBikeWorkout {
  title: string;
  description: string;
  bikeWorkout: BikeWorkout;
}

/** What a plan read needs in order to build its response. */
interface PlanResponseInput {
  userId: number;
  location: AthleteLocation | null;
  timezone: string | null;
  today: string;
  /** After 18:00 the response also reports tomorrow's plan. */
  includeTomorrow?: boolean;
  /** The athlete opted in to diet advice, so a missing target is pending. */
  dietAdvice?: boolean;
}

/**
 * Finds the indoor bike workout for a date. Today and tomorrow come from the
 * day plans so the download matches the Day tab. Other dates only carry week
 * outlines, so the week fallback is kept for plans stored before week outlines.
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

/**
 * Coach plan routes. GET reads the stored plan and reports what is missing for
 * the supplied date. POST runs the generation cascade; the UI calls it without
 * awaiting the response and polls GET for progress.
 */
export function createPlanRoute(deps: ResolvedAppDependencies): Hono {
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

  async function buildResponse(input: PlanResponseInput) {
    const { userId, location, timezone, today } = input;
    const includeTomorrow = input.includeTomorrow === true;
    const dietAdvice = input.dietAdvice === true;
    const loadThresholds =
      deps.loadThresholdHistory ?? loadThresholdHistoryForUser;
    const [
      storedPlan,
      loadedGeneration,
      answers,
      coachingInputs,
      thresholds,
      events,
    ] = await Promise.all([
      loadValidatedPlan(deps.planStore, userId),
      deps.generationStore.load(userId),
      deps.answerStore.listForUser(userId),
      deps.loadCoachingInputs
        ? deps.loadCoachingInputs(userId, startOfWeek(today))
        : loadCoachingInputs(userId, startOfWeek(today)),
      loadThresholds(userId, today).catch((err: unknown) => {
        console.error("[plan] could not load thresholds:", err);
        return null;
      }),
      (deps.loadEvents ?? loadAthleteEvents)(userId).catch((err: unknown) => {
        console.error("[plan] could not load the athlete's events:", err);
        return [];
      }),
    ]);
    // A process that stopped mid-generation leaves the row `running`. Release
    // the claim so the client stops polling and can start a fresh run. Pass the
    // heartbeat we observed: a run that refreshed itself after this read, or
    // one that replaced it, must stay untouched.
    let generation = loadedGeneration;
    if (isStaleRunning(generation)) {
      const message = "The coach stopped before finishing. Try again.";
      const startedAt = await deps.generationStore.fail(
        userId,
        message,
        generation.runId,
      );
      if (startedAt !== null) {
        await (deps.markPlanPromptsFailed ?? markPlanPromptsFailed)(
          userId,
          startedAt,
          message,
        );
      }
      generation = await deps.generationStore.load(userId);
    }
    const answersUpdatedAt = latestAnswerTimestamp(answers);

    // Show a next week or block as current once today has reached it, even
    // before the background promotion has been persisted.
    const plan =
      storedPlan === null ? null : promoteNextPeriod(storedPlan.plan, today);
    const generatedAt =
      storedPlan === null ? null : storedPlan.generatedAt.toISOString();
    const stale =
      storedPlan === null
        ? false
        : planIsStale(storedPlan.answersUpdatedAt, answersUpdatedAt) ||
          (coachingInputs.refreshUpdatedAt !== null &&
            planIsStale(
              storedPlan.coachingInputsUpdatedAt,
              coachingInputs.refreshUpdatedAt,
            ));
    // A generated week review, or an answer to one that asked for a change,
    // revises the block, even while today is still inside the stored block's
    // dates.
    // No week review is not a week review event. `planIsStale` treats a missing
    // current timestamp as stale, which is right for answers but not here: it
    // would report the block pending forever while the generator, which checks
    // that a review exists, has nothing to revise.
    const weekReviewPending =
      storedPlan !== null &&
      coachingInputs.weekReviewNeedsRefresh &&
      coachingInputs.weekReviewUpdatedAt !== null
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
      pending: planPending({
        plan: storedPlan === null ? null : storedPlan.plan,
        today,
        includeTomorrow,
        weatherChanged,
        weekReviewPending,
        dietAdvice,
      }),
      thresholds: thresholds?.summaries ?? [],
      events,
    });
  }

  return new Hono()
    .get("/", async (c) => {
      const user = getUser(c);
      const today = planDateSchema.safeParse(c.req.query("today"));
      if (!today.success) {
        return validationFailed(
          c,
          today.error,
          "A valid today date (YYYY-MM-DD) is required",
        );
      }
      const includeTomorrow = c.req.query("includeTomorrow") === "true";
      return c.json(
        await buildResponse({
          userId: user.id,
          location: user.location,
          timezone: user.timezone,
          today: today.data,
          includeTomorrow,
          dietAdvice: user.dietAdvice,
        }),
      );
    })
    .get(
      "/workouts/:date",
      zValidator("param", workoutDateParamSchema),
      async (c) => {
        const { date } = c.req.valid("param");
        const user = getUser(c);
        const stored = await loadValidatedPlan(deps.planStore, user.id);
        if (stored === null) {
          return notFound(c, "No coach plan is available");
        }
        const workout = findExportableBikeWorkout(stored.plan, date);
        if (workout === null) {
          return notFound(c, "No downloadable bike workout for that date");
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
            "content-disposition": `attachment; filename="${zwoFilename(date, workout.title)}"`,
            "cache-control": "no-store",
          },
        );
      },
    )
    .post(
      "/generate",
      zValidator("json", planGenerateInputSchema),
      async (c) => {
        const user = getUser(c);
        const { today, timezone, mode, force, includeTomorrow } =
          c.req.valid("json");

        const started = await triggerPlanGeneration(
          planTriggerDependencies(deps),
          {
            userId: user.id,
            today,
            ...(timezone !== undefined ? { timezone } : {}),
            mode,
            force,
            includeTomorrow,
          },
        );

        if (!started) {
          return c.json(
            await buildResponse({
              userId: user.id,
              location: user.location,
              timezone: user.timezone,
              today,
              includeTomorrow: false,
              dietAdvice: user.dietAdvice,
            }),
            202,
          );
        }

        return c.json(
          await buildResponse({
            userId: user.id,
            location: user.location,
            timezone: user.timezone,
            today,
            includeTomorrow,
            dietAdvice: user.dietAdvice,
          }),
          202,
        );
      },
    );
}
