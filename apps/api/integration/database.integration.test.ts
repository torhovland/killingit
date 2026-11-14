import "./config.js";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import type { Activity, CoachPlan } from "@killingit/shared";
import { sql } from "drizzle-orm";
import {
  loadStoredActivities,
  loadStoredActivityFeed,
  saveStoredActivities,
} from "../src/coaching/activityStore.js";
import { db } from "../src/db/index.js";
import {
  athleteMetrics,
  coachPlans,
  coachingSurveyAdjustments,
  foodEntries,
  users,
} from "../src/db/schema.js";
import { deleteImportedActivity } from "../src/coaching/deletions.js";
import { saveAnalysis } from "../src/llm/analysisStore.js";
import {
  loadMetricPoints,
  loadThresholdPoints,
  recordAthleteMetricStatements,
  recordCoachThreshold,
  recordGarminBodyMetrics,
  recordGarminFtp,
  recordPlanFtpEstimates,
} from "../src/metrics/store.js";
import { loadPlanDayCalorieTargets } from "../src/plans/dayCalories.js";
import {
  createActivityComment,
  loadManualActivities,
  saveManualActivity,
  updateManualActivity,
  updateManualActivityTss,
} from "../src/plans/inputs.js";
import { PLAN_GENERATION_STEPS } from "../src/plans/steps.js";
import { dbPlanGenerationStore, dbPlanStore } from "../src/plans/store.js";
import { loadPlanWeekTotals } from "../src/plans/weekTotals.js";
import { dbCoachingSurveyAdjustmentStore } from "../src/questions/adjustments.js";
import { dbQuestionAnswerStore } from "../src/questions/answers.js";
import {
  addQuestionVersion,
  archiveQuestion,
  createQuestion,
  listActiveQuestionsWithVersions,
} from "../src/questions/store.js";
import { dbUserStore } from "../src/users/store.js";
import {
  closeIntegrationDatabase,
  countRows,
  listPublicTables,
  prepareIntegrationDatabase,
  truncateAllTables,
  type MigrationResult,
} from "./database.js";
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

let migrationResult: MigrationResult | undefined;

const ONE_SHORT_WORKOUT_WEEK: readonly (FixtureWorkout | null)[] = [
  { durationMinutes: 30, estimatedTss: 20, caloriesKcal: 2500 },
  null,
  null,
  null,
  null,
  null,
  null,
];

function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null; depth += 1) {
    if (typeof current !== "object") {
      return undefined;
    }
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Makes one metric write fail the way a crash or constraint violation would,
 * so a rewrite that deletes before it inserts can be tested between the two.
 */
async function withInjectedInsertFailure(
  table: "athlete_metrics" | "athlete_thresholds",
  marker: number,
  run: () => Promise<void>,
): Promise<void> {
  const trigger = `${table}_integration_failure`;
  await db.execute(sql.raw(`drop trigger if exists ${trigger} on ${table}`));
  await db.execute(
    sql.raw(`
      create or replace function ${trigger}() returns trigger as $$
      begin
        if new.value = ${marker} then
          raise exception 'injected metric write failure';
        end if;
        return new;
      end;
      $$ language plpgsql
    `),
  );
  await db.execute(
    sql.raw(
      `create trigger ${trigger} before insert or update on ${table} ` +
        `for each row execute function ${trigger}()`,
    ),
  );
  try {
    await run();
  } finally {
    await db.execute(sql.raw(`drop trigger if exists ${trigger} on ${table}`));
    await db.execute(sql.raw(`drop function if exists ${trigger}()`));
  }
}

beforeAll(async () => {
  migrationResult = await prepareIntegrationDatabase();
});

beforeEach(async () => {
  // Every test starts with no configured administrator, so a test that grants
  // one cannot leak the setting into the next test.
  delete process.env.ADMIN_AUTH_SUBJECT;
  await truncateAllTables();
});

afterAll(async () => {
  await closeIntegrationDatabase();
});

describe("migrations", () => {
  it("applies every migration to an empty database", () => {
    expect(migrationResult).toBeDefined();
    expect(migrationResult?.applied).toBe(migrationResult?.expected);
    expect(migrationResult?.expected).toBeGreaterThan(0);
  });

  it("creates the tables the stores and lifecycle tests use", async () => {
    const tables = await listPublicTables();
    const requiredTables = [
      "activities",
      "coach_plans",
      "plan_week_totals",
      "plan_day_calories",
      "plan_generations",
      "questions",
      "question_versions",
      "question_answers",
      "coaching_survey_adjustments",
      "users",
    ];
    for (const table of requiredTables) {
      expect(tables).toContain(table);
    }
  });
});

describe("dbUserStore", () => {
  it("provisions every account as a member when no administrator is configured", async () => {
    const first = await dbUserStore.ensureUser("auth0|first-athlete");
    const second = await dbUserStore.ensureUser("auth0|second-athlete");

    expect(first.role).toBe("member");
    expect(second.role).toBe("member");
    expect(await countRows("users")).toBe(2);
  });

  it("provisions only the configured auth subject as the administrator", async () => {
    process.env.ADMIN_AUTH_SUBJECT = "auth0|owner";

    const athlete = await dbUserStore.ensureUser("auth0|athlete");
    const owner = await dbUserStore.ensureUser("auth0|owner");
    const later = await dbUserStore.ensureUser("auth0|later-athlete");

    expect(athlete.role).toBe("member");
    expect(owner.role).toBe("admin");
    expect(later.role).toBe("member");
    expect(await countRows("users")).toBe(3);
  });

  it("promotes an existing member only when its subject is configured", async () => {
    const account = await dbUserStore.ensureUser("auth0|owner");
    expect(account.role).toBe("member");

    process.env.ADMIN_AUTH_SUBJECT = "auth0|owner";
    const promoted = await dbUserStore.ensureUser("auth0|owner");

    expect(promoted.role).toBe("admin");
    expect(await countRows("users")).toBe(1);
  });

  it("never promotes the earliest member after the administrator is deleted", async () => {
    process.env.ADMIN_AUTH_SUBJECT = "auth0|owner";
    const admin = await dbUserStore.ensureUser("auth0|owner");
    const member = await dbUserStore.ensureUser("auth0|member-athlete");
    expect(admin.role).toBe("admin");

    await dbUserStore.deleteUser(admin.sub);

    const returningMember = await dbUserStore.ensureUser(member.sub);
    const newcomer = await dbUserStore.ensureUser("auth0|newcomer");

    expect(returningMember.role).toBe("member");
    expect(newcomer.role).toBe("member");
    const stored = await db.select({ role: users.role }).from(users);
    expect(stored.some((row) => row.role === "admin")).toBe(false);
    expect(stored).toHaveLength(2);
  });

  it("removes every row the account owns when it is deleted", async () => {
    const user = await dbUserStore.ensureUser("auth0|cascade-athlete");
    await dbPlanStore.save({
      userId: user.id,
      plan: makePlan(),
      answersUpdatedAt: null,
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
    });
    await dbPlanGenerationStore.begin(user.id, "run-cascade");
    const question = await createQuestion({
      prompt: "How is the training going?",
      required: true,
    });
    await dbQuestionAnswerStore.saveAnswers(user.id, [
      {
        questionId: question.id,
        versionId: question.versionId,
        answer: "Steady.",
      },
    ]);
    await db.insert(foodEntries).values({
      userId: user.id,
      eatenAt: new Date("2026-11-09T12:00:00.000Z"),
      eatenDate: "2026-11-09",
      eatenTime: "12:00",
      description: "Porridge with berries.",
    });

    expect(await countRows("coach_plans")).toBe(1);
    expect(await countRows("question_answers")).toBe(1);

    await dbUserStore.deleteUser(user.sub);

    expect(await countRows("users")).toBe(0);
    expect(await countRows("coach_plans")).toBe(0);
    expect(await countRows("plan_week_totals")).toBe(0);
    expect(await countRows("plan_day_calories")).toBe(0);
    expect(await countRows("plan_generations")).toBe(0);
    expect(await countRows("question_answers")).toBe(0);
    expect(await countRows("coaching_survey_adjustments")).toBe(0);
    expect(await countRows("food_entries")).toBe(0);

    // Questions and their versions are shared content, not user data.
    expect(await countRows("questions")).toBe(1);
    expect(await countRows("question_versions")).toBe(1);
  });
});

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

describe("dbPlanGenerationStore", () => {
  it("fences a new run and ignores the superseded run's finish", async () => {
    const user = await dbUserStore.ensureUser("auth0|run-fence");

    await dbPlanGenerationStore.begin(user.id, "run-1");
    expect(await dbPlanGenerationStore.isCurrent(user.id, "run-1")).toBe(true);
    const running = await dbPlanGenerationStore.load(user.id);
    expect(running.status).toBe("running");
    expect(running.runId).toBe("run-1");

    await dbPlanGenerationStore.begin(user.id, "run-2");
    expect(await dbPlanGenerationStore.isCurrent(user.id, "run-1")).toBe(false);
    expect(await dbPlanGenerationStore.isCurrent(user.id, "run-2")).toBe(true);

    await dbPlanGenerationStore.finish(user.id, "run-1");
    const afterLateFinish = await dbPlanGenerationStore.load(user.id);
    expect(afterLateFinish.status).toBe("running");
    expect(afterLateFinish.runId).toBe("run-2");

    await dbPlanGenerationStore.finish(user.id, "run-2");
    const done = await dbPlanGenerationStore.load(user.id);
    expect(done.status).toBe("done");
    expect(done.progress).toBe(100);
    expect(done.runId).toBe("run-2");
    expect(await countRows("plan_generation_step_durations")).toBe(1);
  });

  it("fails only the run that owns the row", async () => {
    const user = await dbUserStore.ensureUser("auth0|run-fail");
    await dbPlanGenerationStore.begin(user.id, "run-current");

    expect(
      await dbPlanGenerationStore.fail(user.id, "stale error", "run-older"),
    ).toBeNull();
    const startedAt = await dbPlanGenerationStore.fail(
      user.id,
      "the provider timed out",
      "run-current",
    );
    expect(startedAt).toBeInstanceOf(Date);

    const failed = await dbPlanGenerationStore.load(user.id);
    expect(failed.status).toBe("error");
    expect(failed.error).toBe("the provider timed out");
    expect(failed.runId).toBe("run-current");
    expect(
      await dbPlanGenerationStore.fail(user.id, "again", "run-current"),
    ).toBeNull();
  });

  it("updates and heartbeats only the run that owns the row", async () => {
    const user = await dbUserStore.ensureUser("auth0|run-steps");
    await dbPlanGenerationStore.begin(user.id, "run-a");

    await dbPlanGenerationStore.update(
      user.id,
      PLAN_GENERATION_STEPS.review,
      "run-a",
    );
    expect((await dbPlanGenerationStore.load(user.id)).step).toBe(
      PLAN_GENERATION_STEPS.review.label,
    );

    await dbPlanGenerationStore.begin(user.id, "run-b");
    await dbPlanGenerationStore.update(
      user.id,
      PLAN_GENERATION_STEPS.season,
      "run-a",
    );
    expect((await dbPlanGenerationStore.load(user.id)).step).toBe(
      PLAN_GENERATION_STEPS.prepare.label,
    );

    await dbPlanGenerationStore.heartbeat(user.id, "run-a");
    expect((await dbPlanGenerationStore.load(user.id)).runId).toBe("run-b");
  });
});

describe("question stores", () => {
  it("versions a question and replaces an answer without duplicating it", async () => {
    const user = await dbUserStore.ensureUser("auth0|question-upsert");
    const created = await createQuestion({
      prompt: "How did the long run feel?",
      required: true,
    });
    const versioned = await addQuestionVersion(created.id, {
      prompt: "How did the long run feel, honestly?",
      required: false,
    });
    expect(versioned?.version).toBe(2);
    expect(versioned?.versionCount).toBe(2);
    if (!versioned) {
      throw new Error("expected the new question version");
    }

    const active = await listActiveQuestionsWithVersions();
    expect(active[0]?.versions.map((version) => version.version)).toEqual([
      1, 2,
    ]);

    // The old version is stale once the question has moved on.
    expect(
      await dbQuestionAnswerStore.saveAnswers(user.id, [
        {
          questionId: created.id,
          versionId: created.versionId,
          answer: "Strong",
        },
      ]),
    ).toBe(false);
    expect(await countRows("question_answers")).toBe(0);

    expect(
      await dbQuestionAnswerStore.saveAnswers(user.id, [
        {
          questionId: versioned.id,
          versionId: versioned.versionId,
          answer: "Strong",
        },
      ]),
    ).toBe(true);
    expect(
      await dbQuestionAnswerStore.saveAnswers(user.id, [
        {
          questionId: versioned.id,
          versionId: versioned.versionId,
          answer: "Very strong",
        },
      ]),
    ).toBe(true);

    expect(await countRows("question_answers")).toBe(1);
    expect(await countRows("coaching_survey_adjustments")).toBe(2);

    const adjustments = await db
      .select()
      .from(coachingSurveyAdjustments)
      .orderBy(coachingSurveyAdjustments.id);
    expect(adjustments.at(-1)?.previousAnswer).toBe("Strong");
    expect(adjustments.at(-1)?.answer).toBe("Very strong");
  });

  it("resolves the athlete's answer to an earlier version", async () => {
    const user = await dbUserStore.ensureUser("auth0|question-previous");
    const created = await createQuestion({
      prompt: "How much time can you train?",
      required: true,
    });
    await dbQuestionAnswerStore.saveAnswers(user.id, [
      {
        questionId: created.id,
        versionId: created.versionId,
        answer: "About eight hours a week.",
      },
    ]);

    const versioned = await addQuestionVersion(created.id, {
      prompt: "How many hours a week can you train?",
      required: false,
    });
    if (!versioned) {
      throw new Error("expected the new question version");
    }

    const awaitingNewVersion = await dbQuestionAnswerStore.listForUser(user.id);
    expect(awaitingNewVersion[0]?.answer).toBeNull();
    expect(awaitingNewVersion[0]?.previous).toMatchObject({
      version: 1,
      prompt: "How much time can you train?",
      answer: "About eight hours a week.",
      skipped: false,
    });

    await dbQuestionAnswerStore.saveAnswers(user.id, [
      {
        questionId: versioned.id,
        versionId: versioned.versionId,
        answer: "Around ten hours a week.",
      },
    ]);
    expect(await countRows("question_answers")).toBe(2);

    const answered = await dbQuestionAnswerStore.listForUser(user.id);
    expect(answered[0]?.answer).toBe("Around ten hours a week.");
    expect(answered[0]?.previous?.version).toBe(1);
  });

  it("refuses a required skip and keeps archived answers", async () => {
    const user = await dbUserStore.ensureUser("auth0|question-skip");
    const required = await createQuestion({
      prompt: "What is your goal?",
      required: true,
    });
    const optional = await createQuestion({
      prompt: "Anything else?",
      required: false,
    });

    expect(
      await dbQuestionAnswerStore.saveAnswers(user.id, [
        {
          questionId: required.id,
          versionId: required.versionId,
          answer: null,
        },
      ]),
    ).toBe(false);
    expect(await countRows("question_answers")).toBe(0);

    expect(
      await dbQuestionAnswerStore.saveAnswers(user.id, [
        {
          questionId: optional.id,
          versionId: optional.versionId,
          answer: null,
        },
      ]),
    ).toBe(true);
    expect(
      await dbQuestionAnswerStore.saveAnswers(user.id, [
        {
          questionId: required.id,
          versionId: required.versionId,
          answer: "Ride a century.",
        },
      ]),
    ).toBe(true);

    const skipped = await dbQuestionAnswerStore.listForUser(user.id);
    const optionalQuestion = skipped.find(
      (question) => question.id === optional.id,
    );
    expect(optionalQuestion?.skipped).toBe(true);

    await archiveQuestion(required.id);
    expect(
      (await listActiveQuestionsWithVersions()).map((question) => question.id),
    ).toEqual([optional.id]);
    expect(await countRows("question_versions")).toBe(2);
    expect(await countRows("question_answers")).toBe(2);
  });

  it("clears only the survey adjustments a refresh loaded", async () => {
    const user = await dbUserStore.ensureUser("auth0|adjustment-consumed");
    const question = await createQuestion({
      prompt: "How many hours can you train each week?",
      required: true,
    });
    await dbQuestionAnswerStore.saveAnswers(user.id, [
      {
        questionId: question.id,
        versionId: question.versionId,
        answer: "About eight hours a week.",
      },
    ]);

    // The season refresh loads this snapshot into its prompt.
    const loaded = await dbCoachingSurveyAdjustmentStore.listForUser(user.id);
    expect(loaded).toHaveLength(1);

    // The athlete edits the answer while the run is still generating.
    await dbQuestionAnswerStore.saveAnswers(user.id, [
      {
        questionId: question.id,
        versionId: question.versionId,
        answer: "About ten hours a week.",
      },
    ]);

    await dbCoachingSurveyAdjustmentStore.clearConsumed(
      user.id,
      loaded.map((adjustment) => adjustment.id),
    );

    // Only the loaded snapshot was consumed, so the mid-run edit still reaches
    // the next refresh.
    const pending = await dbCoachingSurveyAdjustmentStore.listForUser(user.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.answer).toBe("About ten hours a week.");
  });
});

describe("metrics stores", () => {
  const THROUGH_DATE = "2026-11-12";
  const FTP = {
    sport: "cycling",
    measure: "ftp",
    label: "FTP",
    unit: "W",
    kind: "power" as const,
  };

  it("keeps the athlete's points when a reading fails after the delete", async () => {
    const user = await dbUserStore.ensureUser("auth0|metrics-rollback");
    await recordAthleteMetricStatements(
      user.id,
      [
        {
          date: "2026-01-05",
          weightKg: 81,
          bodyFatPercent: 22.5,
          thresholds: [{ ...FTP, value: 250 }],
        },
      ],
      THROUGH_DATE,
    );

    let failed = false;
    await withInjectedInsertFailure("athlete_metrics", 99, async () => {
      try {
        await recordAthleteMetricStatements(
          user.id,
          [
            {
              date: "2026-03-02",
              weightKg: 79,
              bodyFatPercent: 99,
              thresholds: [{ ...FTP, value: 260 }],
            },
          ],
          THROUGH_DATE,
        );
      } catch {
        failed = true;
      }
    });
    expect(failed).toBe(true);

    expect(await loadMetricPoints(user.id, "weight")).toEqual([
      { date: "2026-01-05", value: 81, source: "user" },
    ]);
    expect(await loadMetricPoints(user.id, "body_fat")).toEqual([
      { date: "2026-01-05", value: 22.5, source: "user" },
    ]);
    expect(await loadThresholdPoints(user.id)).toEqual([
      {
        ...FTP,
        date: "2026-01-05",
        value: 250,
        source: "user",
      },
    ]);
  });

  it("replaces only the measures the reading reports and lets the last statement win", async () => {
    const user = await dbUserStore.ensureUser("auth0|metrics-rewrite");
    await db.insert(athleteMetrics).values({
      userId: user.id,
      metric: "weight",
      source: "garmin",
      date: "2026-02-01",
      value: 80.5,
    });
    await recordAthleteMetricStatements(
      user.id,
      [
        {
          date: "2026-01-05",
          weightKg: 81,
          bodyFatPercent: null,
          thresholds: [],
        },
        {
          date: "2026-01-06",
          weightKg: 80.8,
          bodyFatPercent: 22,
          thresholds: [{ ...FTP, value: 250 }],
        },
      ],
      THROUGH_DATE,
    );

    await recordAthleteMetricStatements(
      user.id,
      [
        {
          date: "2026-01-06",
          weightKg: 80.2,
          bodyFatPercent: null,
          thresholds: [],
        },
        {
          date: "2026-01-06",
          weightKg: 80.1,
          bodyFatPercent: null,
          thresholds: [],
        },
      ],
      THROUGH_DATE,
    );

    // The edited-out weight on 5 January is gone, the same-day statements keep
    // the last value, and the Garmin weigh-in and the unreported measures stay.
    expect(await loadMetricPoints(user.id, "weight")).toEqual([
      { date: "2026-01-06", value: 80.1, source: "user" },
      { date: "2026-02-01", value: 80.5, source: "garmin" },
    ]);
    expect(await loadMetricPoints(user.id, "body_fat")).toEqual([
      { date: "2026-01-06", value: 22, source: "user" },
    ]);
    expect(await loadThresholdPoints(user.id)).toEqual([
      { ...FTP, date: "2026-01-06", value: 250, source: "user" },
    ]);
  });

  it("keeps the older coach estimates when a newer one fails to store", async () => {
    const user = await dbUserStore.ensureUser("auth0|coach-threshold-rollback");
    await recordCoachThreshold({
      userId: user.id,
      ...FTP,
      date: "2026-01-01",
      value: 240,
    });
    await recordCoachThreshold({
      userId: user.id,
      ...FTP,
      date: "2026-02-01",
      value: 250,
    });

    let failed = false;
    await withInjectedInsertFailure("athlete_thresholds", 9999, async () => {
      try {
        await recordCoachThreshold({
          userId: user.id,
          ...FTP,
          date: "2026-01-15",
          value: 9999,
        });
      } catch {
        failed = true;
      }
    });
    expect(failed).toBe(true);

    expect(
      (await loadThresholdPoints(user.id)).map((point) => [
        point.date,
        point.value,
      ]),
    ).toEqual([
      ["2026-01-01", 240],
      ["2026-02-01", 250],
    ]);
  });

  it("stores a Garmin sync's weigh-ins in one batch or not at all", async () => {
    const user = await dbUserStore.ensureUser("auth0|garmin-batch-failure");

    let failed = false;
    await withInjectedInsertFailure("athlete_metrics", 79.9, async () => {
      try {
        await recordGarminBodyMetrics(user.id, [
          { date: "2026-02-01", weightKg: 80.4, bodyFatPercent: 21 },
          { date: "2026-02-02", weightKg: 79.9, bodyFatPercent: 20.9 },
        ]);
      } catch {
        failed = true;
      }
    });
    expect(failed).toBe(true);

    // One statement means a bad sample cannot leave the earlier ones stored.
    expect(await loadMetricPoints(user.id, "weight")).toEqual([]);
    expect(await loadMetricPoints(user.id, "body_fat")).toEqual([]);
  });

  it("stores a Garmin FTP sync in one batch or not at all", async () => {
    const user = await dbUserStore.ensureUser("auth0|garmin-ftp-batch-failure");

    let failed = false;
    await withInjectedInsertFailure("athlete_thresholds", 290, async () => {
      try {
        await recordGarminFtp(user.id, [
          { date: "2026-02-01", watts: 280 },
          { date: "2026-02-02", watts: 290 },
        ]);
      } catch {
        failed = true;
      }
    });
    expect(failed).toBe(true);

    expect(await loadThresholdPoints(user.id)).toEqual([]);
  });

  it("keeps the last value for a day a batch names twice", async () => {
    const user = await dbUserStore.ensureUser(
      "auth0|garmin-batch-duplicate-day",
    );

    await recordGarminBodyMetrics(user.id, [
      { date: "2026-02-01", weightKg: 80.4, bodyFatPercent: 21 },
      { date: "2026-02-01", weightKg: 80.2, bodyFatPercent: 20.8 },
      { date: "2026-02-02", weightKg: 80.0 },
    ]);
    await recordGarminFtp(user.id, [
      { date: "2026-02-01", watts: 280 },
      { date: "2026-02-01", watts: 285 },
    ]);

    expect(await loadMetricPoints(user.id, "weight")).toEqual([
      { date: "2026-02-01", value: 80.2, source: "garmin" },
      { date: "2026-02-02", value: 80.0, source: "garmin" },
    ]);
    expect(await loadMetricPoints(user.id, "body_fat")).toEqual([
      { date: "2026-02-01", value: 20.8, source: "garmin" },
    ]);
    expect(await loadThresholdPoints(user.id)).toEqual([
      { ...FTP, date: "2026-02-01", value: 285, source: "garmin" },
    ]);
  });

  it("keeps an athlete value a Garmin sync finds already stored", async () => {
    const user = await dbUserStore.ensureUser("auth0|garmin-batch-precedence");
    await recordAthleteMetricStatements(
      user.id,
      [
        {
          date: "2026-02-01",
          weightKg: 78,
          bodyFatPercent: null,
          thresholds: [{ ...FTP, value: 260 }],
        },
      ],
      THROUGH_DATE,
    );

    await recordGarminBodyMetrics(user.id, [
      { date: "2026-02-01", weightKg: 79, bodyFatPercent: 22 },
      { date: "2026-02-02", weightKg: 78.5, bodyFatPercent: 21.5 },
    ]);
    await recordGarminFtp(user.id, [
      { date: "2026-02-01", watts: 300 },
      { date: "2026-02-02", watts: 305 },
    ]);

    expect(await loadMetricPoints(user.id, "weight")).toEqual([
      { date: "2026-02-01", value: 78, source: "user" },
      { date: "2026-02-02", value: 78.5, source: "garmin" },
    ]);
    expect(await loadMetricPoints(user.id, "body_fat")).toEqual([
      { date: "2026-02-01", value: 22, source: "garmin" },
      { date: "2026-02-02", value: 21.5, source: "garmin" },
    ]);
    expect(await loadThresholdPoints(user.id)).toEqual([
      { ...FTP, date: "2026-02-01", value: 260, source: "user" },
      { ...FTP, date: "2026-02-02", value: 305, source: "garmin" },
    ]);
  });

  it("applies a batch of plan FTP estimates and drops the projection after the oldest", async () => {
    const user = await dbUserStore.ensureUser("auth0|plan-ftp-batch");
    for (const [date, value] of [
      ["2026-01-01", 240],
      ["2026-01-15", 245],
      ["2026-02-01", 250],
    ] as const) {
      await recordCoachThreshold({ userId: user.id, ...FTP, date, value });
    }

    await recordPlanFtpEstimates(user.id, [
      { date: "2026-01-08", watts: 242 },
      { date: "2026-01-20", watts: 248 },
    ]);

    // The estimate before the batch stays, the stale projection after the
    // oldest estimate of the batch goes, and the batch itself is stored.
    expect(
      (await loadThresholdPoints(user.id)).map((point) => [
        point.date,
        point.value,
      ]),
    ).toEqual([
      ["2026-01-01", 240],
      ["2026-01-08", 242],
      ["2026-01-20", 248],
    ]);
  });
});

function syncedActivity(
  id: number,
  startDate: string,
  name = "Morning ride",
): Activity {
  return {
    id,
    name,
    type: "cycling",
    startDate,
    distance: 20000,
    movingTime: 3600,
    elapsedTime: 3700,
    totalElevationGain: 200,
    samples: [
      {
        timestamp: "2026-10-01T07:00:00Z",
        latitude: 59.9,
        longitude: 10.7,
        power: 200,
      },
      {
        timestamp: "2026-10-01T07:01:00Z",
        latitude: 59.91,
        longitude: 10.71,
        power: 210,
      },
    ],
  };
}

describe("stored activity rows", () => {
  it("stores one row per activity and updates a re-synced activity in place", async () => {
    const user = await dbUserStore.ensureUser("auth0|activity-rows");
    await saveStoredActivities(user.id, [
      syncedActivity(1, "2026-10-01T07:00:00Z"),
    ]);
    await saveStoredActivities(user.id, [
      syncedActivity(1, "2026-10-01T07:00:00Z", "Renamed ride"),
    ]);

    const feed = await loadStoredActivityFeed(user.id, "samples");

    expect(feed.activities).toHaveLength(1);
    expect(feed.activities[0]?.name).toBe("Renamed ride");
    expect(feed.activities[0]?.sampleCount).toBe(2);
    expect(feed.activities[0]?.samples).toHaveLength(2);
  });

  it("loads the sample preview and route only when they are asked for", async () => {
    const user = await dbUserStore.ensureUser("auth0|activity-preview");
    await saveStoredActivities(user.id, [
      syncedActivity(1, "2026-10-01T07:00:00Z"),
    ]);

    const summary = await loadStoredActivities(user.id);
    expect(summary[0]?.samples).toEqual([]);
    expect(summary[0]?.route).toBeUndefined();

    const routed = await loadStoredActivities(user.id, "route");
    expect(routed[0]?.route).toHaveLength(2);
    expect(routed[0]?.samples).toEqual([]);

    const full = await loadStoredActivities(user.id, "samples");
    expect(full[0]?.samples).toHaveLength(2);
    expect(full[0]?.route).toHaveLength(2);
  });

  it("keeps the stored history newest first and drops a deleted activity", async () => {
    const user = await dbUserStore.ensureUser("auth0|activity-deletion");
    await saveStoredActivities(user.id, [
      syncedActivity(1, "2026-10-01T07:00:00Z"),
      syncedActivity(2, "2026-10-03T07:00:00Z"),
    ]);
    await saveStoredActivities(user.id, [], new Set(["2"]));

    const feed = await loadStoredActivityFeed(user.id);

    expect(feed.activities.map((activity) => activity.id)).toEqual([1]);
  });

  it("removes the activity and its coach work when the athlete deletes it", async () => {
    const user = await dbUserStore.ensureUser("auth0|activity-delete-row");
    await saveStoredActivities(user.id, [
      syncedActivity(1, "2026-10-01T07:00:00Z"),
    ]);
    await saveAnalysis({
      userId: user.id,
      activityId: 1,
      model: "test-model",
      promptVersion: 1,
      text: "A steady aerobic ride.",
      planChangeNeeded: false,
    });

    await deleteImportedActivity(user.id, "1");

    expect(await loadStoredActivityFeed(user.id)).toEqual({
      model: null,
      activities: [],
    });
    expect(await countRows("activities")).toBe(0);
    expect(await countRows("activity_analyses")).toBe(0);
  });

  it("attaches the stored analysis and athlete comment to the feed", async () => {
    const user = await dbUserStore.ensureUser("auth0|activity-coach-work");
    await saveStoredActivities(user.id, [
      syncedActivity(1, "2026-10-01T07:00:00Z"),
    ]);
    await saveAnalysis({
      userId: user.id,
      activityId: 1,
      model: "test-model",
      promptVersion: 1,
      text: "A steady aerobic ride.",
      planChangeNeeded: false,
    });
    await createActivityComment(user.id, {
      activityId: "1",
      comment: "Felt strong.",
    });

    const feed = await loadStoredActivityFeed(user.id);

    expect(feed.activities[0]?.analysis?.text).toBe("A steady aerobic ride.");
    expect(feed.activities[0]?.comment).toBe("Felt strong.");
  });
});

describe("manual activity writes", () => {
  it("updates the athlete's own entry and stores its estimate separately", async () => {
    const owner = await dbUserStore.ensureUser("auth0|manual-owner");
    const other = await dbUserStore.ensureUser("auth0|manual-other");
    const id = await saveManualActivity(owner.id, {
      startDate: "2026-10-20",
      details: "An easy hour on the bike",
      estimatedTss: 40,
    });

    const updated = await updateManualActivity(owner.id, id, {
      startDate: "2026-10-20",
      details: "A hard hour on the bike",
      estimatedTss: null,
    });
    await updateManualActivityTss(owner.id, id, 96);

    expect(updated).toBe(true);
    const [stored] = await loadManualActivities(owner.id);
    expect(stored?.details).toBe("A hard hour on the bike");
    expect(stored?.estimatedTss).toBe(96);

    // A foreign account's id answers exactly like a missing one and leaves the
    // athlete's entry untouched.
    expect(
      await updateManualActivity(other.id, id, {
        startDate: "2026-10-20",
        details: "Not my entry",
        estimatedTss: null,
      }),
    ).toBe(false);
    expect(
      await updateManualActivity(other.id, id + 1, {
        startDate: "2026-10-20",
        details: "Not my entry",
        estimatedTss: null,
      }),
    ).toBe(false);
    await updateManualActivityTss(other.id, id, 200);
    expect((await loadManualActivities(owner.id))[0]?.estimatedTss).toBe(96);
  });
});
