import "./setup.js";
import { describe, expect, it } from "bun:test";
import type { CoachPlan } from "@killingit/shared";
import { db } from "../src/db/index.js";
import { coachPlans } from "../src/db/schema.js";
import { loadPlanDayCalorieTargets } from "../src/plans/dayCalories.js";
import { dbPlanGenerationStore, dbPlanStore } from "../src/plans/store.js";
import { loadPlanWeekTotals } from "../src/plans/weekTotals.js";
import { dbUserStore } from "../src/users/store.js";
import { countRows } from "./database.js";
import { postgresErrorCode } from "./helpers.js";
import {
  NEXT_WEEK_CALORIES_KCAL,
  NEXT_WEEK_START,
  PLAN_TOMORROW_DATE,
  PLAN_WEEK_START,
  TODAY_CALORIES_KCAL,
  TOMORROW_CALORIES_KCAL,
  makePlan,
  type FixtureWorkout,
} from "./planFixture.js";
import { setupIntegrationSuite } from "./setup.js";

setupIntegrationSuite();

const ONE_SHORT_WORKOUT_WEEK: readonly (FixtureWorkout | null)[] = [
  { durationMinutes: 30, estimatedTss: 20, caloriesKcal: 2500 },
  null,
  null,
  null,
  null,
  null,
  null,
];

describe("dbPlanStore", () => {
  it("upserts a single plan row per user", async () => {
    const user = await dbUserStore.ensureUser("auth0|plan-upsert");

    const first = await dbPlanStore.save({
      userId: user.id,
      plan: makePlan(),
      answersUpdatedAt: null,
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
    });
    expect(first?.plan.today.title).toBe("Today's session");

    const second = await dbPlanStore.save({
      userId: user.id,
      plan: makePlan({ todayTitle: "A revised plan" }),
      answersUpdatedAt: null,
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
    });
    expect(second?.plan.today.title).toBe("A revised plan");
    expect(await countRows("coach_plans")).toBe(1);
    expect((await dbPlanStore.load(user.id))?.plan.today.title).toBe(
      "A revised plan",
    );
  });

  it("enforces the unique coach_plans user index", async () => {
    const user = await dbUserStore.ensureUser("auth0|plan-unique");
    const plan = makePlan();
    await dbPlanStore.save({
      userId: user.id,
      plan,
      answersUpdatedAt: null,
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
    });

    let code: string | undefined;
    try {
      await db.insert(coachPlans).values({
        userId: user.id,
        season: plan.season,
        block: plan.block,
        week: plan.week,
        today: plan.today,
        tomorrow: plan.tomorrow,
        nextWeek: plan.nextWeek,
        nextBlock: plan.nextBlock,
        diet: plan.diet,
        dayDate: plan.today.date,
        weekStartDate: plan.week.startDate,
        blockStartDate: plan.block.startDate,
        blockEndDate: plan.block.endDate,
        seasonStartDate: plan.season.startDate,
        seasonEndDate: plan.season.endDate,
      });
    } catch (error) {
      code = postgresErrorCode(error);
    }

    expect(code).toBe("23505");
  });

  it("writes week totals and day calories alongside the plan", async () => {
    const user = await dbUserStore.ensureUser("auth0|plan-companions");
    await dbPlanStore.save({
      userId: user.id,
      plan: makePlan(),
      answersUpdatedAt: null,
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
    });

    const weeks = await loadPlanWeekTotals(user.id);
    expect(weeks.get(PLAN_WEEK_START)).toEqual({
      plannedMinutes: 150,
      plannedTss: 120,
    });
    expect(weeks.get(NEXT_WEEK_START)).toEqual({
      plannedMinutes: 120,
      plannedTss: 100,
    });

    const targets = await loadPlanDayCalorieTargets(
      user.id,
      "2026-11-01",
      "2026-11-30",
    );
    expect(targets.get(PLAN_WEEK_START)).toEqual({
      caloriesKcal: TODAY_CALORIES_KCAL,
      calorieBreakdown: {
        basalMetabolismKcal: 1900,
        workoutCaloriesKcal: TODAY_CALORIES_KCAL - 1700,
        dietDeficitKcal: 200,
      },
    });
    expect(targets.get(PLAN_TOMORROW_DATE)).toEqual({
      caloriesKcal: TOMORROW_CALORIES_KCAL,
      calorieBreakdown: {
        basalMetabolismKcal: 1900,
        workoutCaloriesKcal: TOMORROW_CALORIES_KCAL - 1700,
        dietDeficitKcal: 200,
      },
    });
    expect(targets.get(NEXT_WEEK_START)).toEqual({
      caloriesKcal: NEXT_WEEK_CALORIES_KCAL,
      calorieBreakdown: {
        basalMetabolismKcal: 1900,
        workoutCaloriesKcal: NEXT_WEEK_CALORIES_KCAL - 1700,
        dietDeficitKcal: 200,
      },
    });
    expect(await countRows("plan_week_totals")).toBe(2);
    expect(await countRows("plan_day_calories")).toBe(3);

    // Saving the same weeks and days again updates the rows in place.
    await dbPlanStore.save({
      userId: user.id,
      plan: makePlan({ weekWorkouts: ONE_SHORT_WORKOUT_WEEK }),
      answersUpdatedAt: null,
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
    });
    expect(await countRows("plan_week_totals")).toBe(2);
    expect((await loadPlanWeekTotals(user.id)).get(PLAN_WEEK_START)).toEqual({
      plannedMinutes: 30,
      plannedTss: 20,
    });
  });

  it("rolls back the plan and its companion rows when the transaction fails", async () => {
    const user = await dbUserStore.ensureUser("auth0|plan-rollback");
    await dbPlanGenerationStore.begin(user.id, "run-rollback");

    const valid = makePlan();
    const invalidPlan: CoachPlan = {
      ...valid,
      week: {
        ...valid.week,
        sessions: valid.week.sessions.map((session, index) =>
          index === 0 ? { ...session, date: "bad" } : session,
        ),
      },
    };

    let failed = false;
    try {
      await dbPlanStore.save({
        userId: user.id,
        plan: invalidPlan,
        answersUpdatedAt: null,
        coachingInputsUpdatedAt: null,
        activitiesUpdatedAt: null,
        runId: "run-rollback",
      });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);

    expect(await countRows("coach_plans")).toBe(0);
    expect(await countRows("plan_week_totals")).toBe(0);
    expect(await countRows("plan_day_calories")).toBe(0);
  });

  it("makes a superseded run's late save a no-op", async () => {
    const user = await dbUserStore.ensureUser("auth0|run-superseded");
    await dbPlanGenerationStore.begin(user.id, "run-a");
    await dbPlanStore.save({
      userId: user.id,
      plan: makePlan(),
      answersUpdatedAt: null,
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      runId: "run-a",
    });

    await dbPlanGenerationStore.begin(user.id, "run-b");
    expect(await dbPlanGenerationStore.isCurrent(user.id, "run-a")).toBe(false);

    const latePlan = makePlan({
      todayTitle: "Late result from run A",
      weekWorkouts: ONE_SHORT_WORKOUT_WEEK,
    });
    expect(
      await dbPlanStore.save({
        userId: user.id,
        plan: latePlan,
        answersUpdatedAt: null,
        coachingInputsUpdatedAt: null,
        activitiesUpdatedAt: null,
        runId: "run-a",
      }),
    ).toBeNull();
    expect((await dbPlanStore.load(user.id))?.plan.today.title).toBe(
      "Today's session",
    );
    expect((await loadPlanWeekTotals(user.id)).get(PLAN_WEEK_START)).toEqual({
      plannedMinutes: 150,
      plannedTss: 120,
    });

    const acceptedPlan = makePlan({
      todayTitle: "Plan from run B",
      weekWorkouts: ONE_SHORT_WORKOUT_WEEK,
    });
    expect(
      await dbPlanStore.save({
        userId: user.id,
        plan: acceptedPlan,
        answersUpdatedAt: null,
        coachingInputsUpdatedAt: null,
        activitiesUpdatedAt: null,
        runId: "run-b",
      }),
    ).not.toBeNull();
    expect((await dbPlanStore.load(user.id))?.plan.today.title).toBe(
      "Plan from run B",
    );
    expect((await loadPlanWeekTotals(user.id)).get(PLAN_WEEK_START)).toEqual({
      plannedMinutes: 30,
      plannedTss: 20,
    });
  });
});
