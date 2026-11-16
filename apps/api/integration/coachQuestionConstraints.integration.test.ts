import "./setup.js";
import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { coachQuestions } from "../src/db/schema.js";
import { dbUserStore } from "../src/users/store.js";
import { countRows } from "./database.js";
import { postgresErrorCode } from "./helpers.js";
import { setupIntegrationSuite } from "./setup.js";

setupIntegrationSuite();

describe("coach question constraints", () => {
  it("allows at most one pending question per account", async () => {
    const owner = await dbUserStore.ensureUser("auth0|pending-owner");
    const other = await dbUserStore.ensureUser("auth0|pending-other");

    const [pending] = await db
      .insert(coachQuestions)
      .values({
        userId: owner.id,
        question: "How did the long ride feel?",
        sourceKind: "weekly_update",
        model: "test-model",
      })
      .returning({ id: coachQuestions.id });
    if (pending === undefined) {
      throw new Error("failed to store the first pending question");
    }

    let duplicateCode: string | undefined;
    try {
      await db.insert(coachQuestions).values({
        userId: owner.id,
        question: "A second pending question?",
        sourceKind: "daily_update",
        model: "test-model",
      });
    } catch (error) {
      duplicateCode = postgresErrorCode(error);
    }
    expect(duplicateCode).toBe("23505");

    // The rule is per account, so another athlete still gets a question, and
    // answering the first frees the slot for the next one.
    await db.insert(coachQuestions).values({
      userId: other.id,
      question: "How is the knee?",
      sourceKind: "activity_analysis",
      model: "test-model",
    });
    await db
      .update(coachQuestions)
      .set({ answer: "Fine.", answeredAt: new Date() })
      .where(eq(coachQuestions.id, pending.id));
    await db.insert(coachQuestions).values({
      userId: owner.id,
      question: "Ready for the next block?",
      sourceKind: "block_update",
      model: "test-model",
    });

    expect(await countRows("coach_questions")).toBe(3);
  });
});
