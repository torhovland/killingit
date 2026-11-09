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
import { triggerPlanGeneration } from "../plans/trigger.js";
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

  async function buildResponse(
    userId: number,
    location: AthleteLocation | null,
    timezone: string | null,
    today: string,
    includeTomorrow = false,
    dietAdvice = false,
  ) {
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
      deps.planStore.load(userId),
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
    // No week review is not a week review event. `planIsStale` treats a missing
    // current timestamp as stale, which is right for answers but not here: it
    // would report the block pending forever while the generator, which checks
    // that a review exists, has nothing to revise.
    const weekReviewPending =
      storedPlan &&
      parsed?.success &&
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
      pending: planPending(
        stored,
        today,
        includeTomorrow,
        weatherChanged,
        weekReviewPending,
        dietAdvice,
      ),
      thresholds: thresholds?.summaries ?? [],
      events,
    });
  }

  return new Hono()
    .get("/", async (c) => {
      const user = await deps.userStore.ensureUser(getAthlete(c).sub);
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
          user.dietAdvice,
        ),
      );
    })
    .get("/workouts/:date", async (c) => {
      const date = planDateSchema.safeParse(c.req.param("date"));
      if (!date.success) {
        return c.text("A valid date (YYYY-MM-DD) is required", 400);
      }
      const user = await deps.userStore.ensureUser(getAthlete(c).sub);
      const stored = await deps.planStore.load(user.id);
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
        const user = await deps.userStore.ensureUser(getAthlete(c).sub);
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
            await buildResponse(
              user.id,
              user.location,
              user.timezone,
              today,
              false,
              user.dietAdvice,
            ),
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
            user.dietAdvice,
          ),
          202,
        );
      },
    );
}
