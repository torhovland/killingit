import { describe, expect, it } from "bun:test";
import type { CoachPlan, DailyWeather, WeekPlan } from "@killingit/shared";
import {
  makeAnalyzedActivity,
  makeBlock,
  makeDay,
  makePlan,
  makeWeek,
  PLAN_TODAY,
} from "../testFixtures/plan.js";
import {
  COACH_PLAN_FINALISATION,
  FINALIZE_PLAN_STEPS,
  finalizePlan,
  SETTLEMENT_FINALISATION,
  STORED_PLAN_FINALISATION,
  type FinalizePlanInput,
} from "./finalize.js";

const BIKE_WORKOUT = {
  ftpWatts: 250,
  intervals: [{ durationSeconds: 600, powerPercent: 75 }],
};

function finalizeInput(
  overrides: Partial<FinalizePlanInput> = {},
): FinalizePlanInput {
  return {
    today: PLAN_TODAY,
    includeTomorrow: false,
    activities: [],
    manualActivities: [],
    ...overrides,
  };
}

function makeWeather(date: string, icon: DailyWeather["icon"]): DailyWeather {
  return {
    date,
    icon,
    temperatureMaxC: 15,
    temperatureMinC: 7,
    windMaxMs: 3,
    gustMaxMs: 5,
    precipitationMm: 0,
  };
}

/** The fixture week with a structured indoor workout on every day. */
function makeBikeWeek(): WeekPlan {
  const week = makeWeek();
  return {
    ...week,
    sessions: week.sessions.map((session) => ({
      ...session,
      bikeWorkout: BIKE_WORKOUT,
    })),
  };
}

/** Today's week session, which every session-level assertion reads. */
function todaySession(plan: CoachPlan) {
  return plan.week.sessions.find((session) => session.date === PLAN_TODAY);
}

describe("finalizePlan", () => {
  it("runs the steps in the order the pipeline declares", () => {
    // `finalizePlan` iterates this list, so the declared order is the executed
    // order. Reordering the pipeline without reordering this list fails here,
    // and the behaviour tests below pin the two orders that change the plan.
    expect(FINALIZE_PLAN_STEPS).toEqual([
      "settleToday",
      "settleCompletedDays",
      "outlineWeeks",
      "dropUnplacedTomorrow",
      "attachForecast",
      "syncDietProgress",
      "applyTrainingLoad",
      "validatePlan",
    ]);
  });

  it("states what each preset runs, so a path opts out instead of repeating a pipeline", () => {
    expect(COACH_PLAN_FINALISATION).toEqual({
      settleToday: true,
      settleCompletedDays: true,
      outlineWeeks: true,
      dropUnplacedTomorrow: true,
      attachForecast: true,
      syncDietProgress: true,
      applyTrainingLoad: true,
      validatePlan: true,
    });
    // A fresh build settles the recorded data before a next-period or
    // progress-only completion reads the plan.
    expect(SETTLEMENT_FINALISATION).toEqual({
      settleToday: true,
      settleCompletedDays: true,
      outlineWeeks: false,
      dropUnplacedTomorrow: false,
      attachForecast: false,
      syncDietProgress: false,
      applyTrainingLoad: false,
      validatePlan: false,
    });
    // The re-save keeps the stored training content: it settles the recorded
    // data but does not re-outline, re-attach the forecast, re-sync the diet
    // targets or re-validate a plan it did not write.
    expect(STORED_PLAN_FINALISATION).toEqual({
      settleToday: true,
      settleCompletedDays: true,
      outlineWeeks: false,
      dropUnplacedTomorrow: true,
      attachForecast: false,
      syncDietProgress: false,
      applyTrainingLoad: true,
      validatePlan: false,
    });
  });

  it("outlines the week before it scores it, so a stripped workout sets no TSS", () => {
    const finalized = finalizePlan(
      makePlan({ week: makeBikeWeek() }),
      finalizeInput(),
      COACH_PLAN_FINALISATION,
    );

    expect(todaySession(finalized)?.bikeWorkout).toBeNull();
    // 45 easy minutes without a structured workout is 30 TSS; the 10-minute
    // interval workout would have scored far less had it been outlined after
    // the load was resolved.
    expect(todaySession(finalized)?.trainingLoad?.tss).toBe(30);
  });

  it("settles today's status before the week, so the day and the week agree", () => {
    const day = makeDay(PLAN_TODAY, { durationMinutes: 90 });
    const week = makeWeek();
    const plan = makePlan({
      today: day,
      week: {
        ...week,
        sessions: week.sessions.map((session) =>
          session.date === PLAN_TODAY
            ? { ...session, durationMinutes: 20 }
            : session,
        ),
      },
    });
    const finalized = finalizePlan(
      plan,
      finalizeInput({
        activities: [
          makeAnalyzedActivity({
            startDate: `${PLAN_TODAY}T07:00:00Z`,
            elapsedTime: 1800,
          }),
        ],
      }),
      COACH_PLAN_FINALISATION,
    );

    // 30 recorded minutes is partial against the 90-minute day plan, and the
    // week takes that verdict instead of judging the 20-minute outline itself.
    expect(finalized.today.status).toBe("partial");
    expect(todaySession(finalized)?.status).toBe("partial");
  });

  it("drops an unplaced tomorrow only when the caller does not ask for it", () => {
    const plan = makePlan({
      tomorrow: makeDay("2026-10-30"),
    });

    expect(
      finalizePlan(plan, finalizeInput(), STORED_PLAN_FINALISATION).tomorrow,
    ).toBeNull();
    expect(
      finalizePlan(
        plan,
        finalizeInput({ includeTomorrow: true }),
        STORED_PLAN_FINALISATION,
      ).tomorrow,
    ).not.toBeNull();
  });

  it("keeps a stored plan's training content when the outline and forecast steps are off", () => {
    const week = makeBikeWeek();
    const stored: CoachPlan = makePlan({
      week: {
        ...week,
        sessions: week.sessions.map((session) => ({
          ...session,
          weather: makeWeather(session.date, "sun"),
        })),
      },
    });
    const forecast = [makeWeather(PLAN_TODAY, "rain")];

    const reSaved = finalizePlan(
      stored,
      finalizeInput({ forecast }),
      STORED_PLAN_FINALISATION,
    );
    const rebuilt = finalizePlan(
      stored,
      finalizeInput({ forecast }),
      COACH_PLAN_FINALISATION,
    );

    expect(todaySession(reSaved)?.bikeWorkout).toEqual(BIKE_WORKOUT);
    expect(todaySession(reSaved)?.weather?.icon).toBe("sun");
    expect(todaySession(rebuilt)?.bikeWorkout).toBeNull();
    expect(todaySession(rebuilt)?.weather?.icon).toBe("rain");
  });

  it("does not re-sync the diet progress targets of a stored plan", () => {
    const block = makeBlock({
      dietProgress: {
        targetWeightKg: 80,
        targetBodyFatPercent: 15,
        note: "Hold this block.",
      },
    });
    const plan = makePlan({ block });

    const reSaved = finalizePlan(
      plan,
      finalizeInput(),
      STORED_PLAN_FINALISATION,
    );
    const rebuilt = finalizePlan(
      plan,
      finalizeInput(),
      COACH_PLAN_FINALISATION,
    );

    expect(reSaved.season.blocks[0]?.dietProgress).toBeUndefined();
    expect(rebuilt.season.blocks[0]?.dietProgress).toEqual(
      block.dietProgress ?? null,
    );
  });

  it("does not validate a stored plan that it did not write", () => {
    const stale = makePlan({ today: makeDay("2026-10-22") });

    expect(() =>
      finalizePlan(stale, finalizeInput(), COACH_PLAN_FINALISATION),
    ).toThrow("The coach returned today's session for the wrong date.");
    expect(
      finalizePlan(stale, finalizeInput(), STORED_PLAN_FINALISATION).today.date,
    ).toBe("2026-10-22");
  });
});
