import "./setup.js";
import { describe, expect, it } from "bun:test";
import { db } from "../src/db/index.js";
import { coachingSurveyAdjustments } from "../src/db/schema.js";
import {
  loadPendingCoachQuestion,
  saveCoachQuestions,
} from "../src/plans/coachQuestions.js";
import { dbQuestionAnswerStore } from "../src/questions/answers.js";
import { dbCoachingSurveyAdjustmentStore } from "../src/questions/adjustments.js";
import {
  addQuestionVersion,
  archiveQuestion,
  createQuestion,
  listActiveQuestions,
  listActiveQuestionsWithVersions,
} from "../src/questions/store.js";
import { dbUserStore } from "../src/users/store.js";
import { countRows } from "./database.js";
import { setupIntegrationSuite } from "./setup.js";

setupIntegrationSuite();

describe("question stores", () => {
  it("maps a question and its current version to the stored shape", async () => {
    const created = await createQuestion({
      prompt: "How did the long run feel?",
      required: false,
    });

    const [stored] = await listActiveQuestions();
    if (stored === undefined) {
      throw new Error("expected the active question");
    }
    expect(stored).toEqual({
      id: created.id,
      versionId: created.versionId,
      prompt: "How did the long run feel?",
      required: false,
      version: 1,
      versionCount: 1,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
    // The survey view also carries every version of the same question.
    expect(await listActiveQuestionsWithVersions()).toEqual([
      {
        ...stored,
        versions: [
          {
            versionId: created.versionId,
            version: 1,
            prompt: "How did the long run feel?",
            required: false,
          },
        ],
      },
    ]);
  });

  it("reports an unanswered question and rejects a malformed submission", async () => {
    const user = await dbUserStore.ensureUser("auth0|question-validation");
    const question = await createQuestion({
      prompt: "How did the long run feel?",
      required: true,
    });
    const other = await createQuestion({
      prompt: "Anything else?",
      required: false,
    });

    const unanswered = (await dbQuestionAnswerStore.listForUser(user.id)).find(
      (entry) => entry.id === question.id,
    );
    expect(unanswered).toMatchObject({
      id: question.id,
      answer: null,
      skipped: false,
      answeredAt: null,
      previous: null,
    });

    const answer = {
      questionId: question.id,
      versionId: question.versionId,
      answer: "Strong",
    };
    // An empty submission has nothing to check.
    expect(await dbQuestionAnswerStore.saveAnswers(user.id, [])).toBe(true);
    // An unknown question, another question's version, and a duplicate are all
    // rejected without writing anything.
    expect(
      await dbQuestionAnswerStore.saveAnswers(user.id, [
        { ...answer, questionId: 9_999 },
      ]),
    ).toBe(false);
    expect(
      await dbQuestionAnswerStore.saveAnswers(user.id, [
        { ...answer, versionId: other.versionId },
      ]),
    ).toBe(false);
    expect(
      await dbQuestionAnswerStore.saveAnswers(user.id, [answer, answer]),
    ).toBe(false);
    expect(await countRows("question_answers")).toBe(0);
    expect(await countRows("coaching_survey_adjustments")).toBe(0);
  });

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

    // Resubmitting the same answer changes nothing, so it records no adjustment.
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
    // The first answer on the new version has no earlier response to snapshot.
    expect(adjustments[0]).toMatchObject({
      question: "How did the long run feel, honestly?",
      previousQuestion: null,
      previousAnswer: null,
      answer: "Strong",
    });
    expect(adjustments.at(-1)?.previousQuestion).toBe(
      "How did the long run feel, honestly?",
    );
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

  it("appends survey adjustments through the store", async () => {
    const user = await dbUserStore.ensureUser("auth0|adjustment-append");

    // An empty batch has nothing to write.
    await dbCoachingSurveyAdjustmentStore.append(user.id, []);
    expect(await countRows("coaching_survey_adjustments")).toBe(0);

    await dbCoachingSurveyAdjustmentStore.append(user.id, [
      {
        question: "How many hours can you train each week?",
        previousQuestion: null,
        answer: "About eight hours a week.",
        previousAnswer: null,
      },
      {
        question: "Anything else?",
        previousQuestion: null,
        answer: null,
        previousAnswer: null,
      },
    ]);

    const stored = await dbCoachingSurveyAdjustmentStore.listForUser(user.id);
    expect(
      stored.map(({ question, answer, previousAnswer }) => ({
        question,
        answer,
        previousAnswer,
      })),
    ).toEqual([
      {
        question: "How many hours can you train each week?",
        answer: "About eight hours a week.",
        previousAnswer: null,
      },
      { question: "Anything else?", answer: null, previousAnswer: null },
    ]);
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

  it("stores only the newest non-blank coach question", async () => {
    const user = await dbUserStore.ensureUser("auth0|coach-question");
    const blankUser = await dbUserStore.ensureUser(
      "auth0|coach-question-blank",
    );

    await saveCoachQuestions({
      userId: user.id,
      questions: ["first", "   ", "second"],
      model: "test/model",
      sourceKind: "coach_plan",
    });
    expect((await loadPendingCoachQuestion(user.id))?.question).toBe("second");

    // A response without a question leaves the pending one untouched.
    await saveCoachQuestions({
      userId: user.id,
      questions: ["", "  "],
      model: "test/model",
      sourceKind: "coach_plan",
    });
    expect((await loadPendingCoachQuestion(user.id))?.question).toBe("second");

    await saveCoachQuestions({
      userId: blankUser.id,
      questions: ["", "   "],
      model: "test/model",
      sourceKind: "coach_plan",
    });
    expect(await loadPendingCoachQuestion(blankUser.id)).toBeNull();
  });
});
