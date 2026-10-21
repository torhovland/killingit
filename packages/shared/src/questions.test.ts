import { describe, expect, it } from "bun:test";
import {
  athleteQuestionsResponseSchema,
  isQuestionnaireComplete,
  questionAnswersInputSchema,
  questionArchivedResponseSchema,
  questionInputSchema,
  questionSchema,
  questionsResponseSchema,
} from "./questions.js";

const question = {
  id: 1,
  versionId: 2,
  prompt: "How did the session feel?",
  required: true,
  version: 2,
  versionCount: 2,
  createdAt: "2026-10-20T09:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
};

describe("questionInputSchema", () => {
  it("trims the prompt and defaults required to true", () => {
    const parsed = questionInputSchema.parse({ prompt: "  How did it go?  " });

    expect(parsed).toEqual({ prompt: "How did it go?", required: true });
  });

  it("keeps an explicit required flag", () => {
    const parsed = questionInputSchema.parse({
      prompt: "Anything else?",
      required: false,
    });

    expect(parsed.required).toBe(false);
  });

  it("rejects a blank prompt", () => {
    const result = questionInputSchema.safeParse({ prompt: "   " });

    expect(result.success).toBe(false);
  });

  it("rejects a prompt longer than 2000 characters", () => {
    const result = questionInputSchema.safeParse({ prompt: "a".repeat(2001) });

    expect(result.success).toBe(false);
  });
});

describe("questionSchema", () => {
  it("parses a versioned question", () => {
    const parsed = questionSchema.parse(question);

    expect(parsed.version).toBe(2);
    expect(parsed.versionCount).toBe(2);
  });

  it("rejects non-positive version numbers", () => {
    const result = questionSchema.safeParse({ ...question, version: 0 });

    expect(result.success).toBe(false);
  });
});

describe("question response schemas", () => {
  it("parses a question list", () => {
    const parsed = questionsResponseSchema.parse({ questions: [question] });

    expect(parsed.questions).toHaveLength(1);
  });

  it("parses an archive acknowledgement", () => {
    expect(questionArchivedResponseSchema.parse({ id: 1 })).toEqual({ id: 1 });
  });
});

const athleteQuestion = {
  ...question,
  answer: "A little tired, but the pace held.",
  skipped: false,
  answeredAt: "2026-10-21T08:00:00.000Z",
};

describe("questionAnswersInputSchema", () => {
  it("trims answers and keeps the pinned version", () => {
    const parsed = questionAnswersInputSchema.parse({
      answers: [{ questionId: 1, versionId: 2, answer: "  Felt strong.  " }],
    });

    expect(parsed.answers).toEqual([
      { questionId: 1, versionId: 2, answer: "Felt strong." },
    ]);
  });

  it("accepts a null answer as an explicit optional skip", () => {
    const parsed = questionAnswersInputSchema.parse({
      answers: [{ questionId: 1, versionId: 2, answer: null }],
    });

    expect(parsed.answers[0]?.answer).toBeNull();
  });

  it("rejects blank answers", () => {
    const result = questionAnswersInputSchema.safeParse({
      answers: [{ questionId: 1, versionId: 2, answer: "   " }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects an empty submission", () => {
    const result = questionAnswersInputSchema.safeParse({ answers: [] });

    expect(result.success).toBe(false);
  });

  it("rejects the same question version twice", () => {
    const result = questionAnswersInputSchema.safeParse({
      answers: [
        { questionId: 1, versionId: 2, answer: "First" },
        { questionId: 2, versionId: 2, answer: "Second" },
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe("athlete question response", () => {
  it("parses a question with the athlete's answer", () => {
    const parsed = athleteQuestionsResponseSchema.parse({
      questions: [athleteQuestion],
      complete: true,
    });

    expect(parsed.questions[0]?.answer).toBe(
      "A little tired, but the pace held.",
    );
    expect(parsed.complete).toBe(true);
  });

  it("accepts an unanswered question", () => {
    const parsed = athleteQuestionsResponseSchema.parse({
      questions: [
        {
          ...athleteQuestion,
          answer: null,
          skipped: false,
          answeredAt: null,
        },
      ],
      complete: false,
    });

    expect(parsed.questions[0]?.answer).toBeNull();
    expect(parsed.questions[0]?.skipped).toBe(false);
  });
});

describe("isQuestionnaireComplete", () => {
  it("is complete when required questions are answered and optional ones are skipped", () => {
    expect(
      isQuestionnaireComplete([
        { required: true, answer: "Yes", skipped: false },
        { required: false, answer: null, skipped: true },
      ]),
    ).toBe(true);
  });

  it("is incomplete when an optional question is neither answered nor skipped", () => {
    expect(
      isQuestionnaireComplete([
        { required: true, answer: "Yes", skipped: false },
        { required: false, answer: null, skipped: false },
      ]),
    ).toBe(false);
  });

  it("is incomplete when a required question is skipped", () => {
    expect(
      isQuestionnaireComplete([
        { required: true, answer: null, skipped: true },
        { required: false, answer: "Optional answer", skipped: false },
      ]),
    ).toBe(false);
  });

  it("is complete when there are no questions", () => {
    expect(isQuestionnaireComplete([])).toBe(true);
  });
});
