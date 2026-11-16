import "./setup.js";
import { describe, expect, it } from "bun:test";
import { db } from "../src/db/index.js";
import { foodEntries, users } from "../src/db/schema.js";
import { dbPlanGenerationStore, dbPlanStore } from "../src/plans/store.js";
import { createQuestion } from "../src/questions/store.js";
import { dbQuestionAnswerStore } from "../src/questions/answers.js";
import { dbUserStore } from "../src/users/store.js";
import { countRows } from "./database.js";
import { makePlan } from "./planFixture.js";
import { setupIntegrationSuite } from "./setup.js";

setupIntegrationSuite();

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
