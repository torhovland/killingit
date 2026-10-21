import { describe, expect, it } from "bun:test";
import type { QuestionAnswerInput } from "@killingit/shared";
import type { QuestionAnswerRow } from "../db/schema.js";
import {
  answersMatchCurrentQuestions,
  toStoredAthleteQuestion,
} from "./answers.js";
import type { StoredQuestion } from "./store.js";

const createdAt = new Date("2026-10-20T09:00:00.000Z");
const updatedAt = new Date("2026-10-21T09:00:00.000Z");

const question: StoredQuestion = {
  id: 7,
  versionId: 11,
  prompt: "How did the long run feel?",
  required: true,
  version: 2,
  versionCount: 2,
  createdAt,
  updatedAt,
};

const answer: QuestionAnswerRow = {
  id: 3,
  userId: 42,
  questionVersionId: 11,
  answer: "Strong until the last 3 km.",
  createdAt: updatedAt,
  updatedAt,
};

const submitted: QuestionAnswerInput = {
  questionId: 7,
  versionId: 11,
  answer: "Strong until the last 3 km.",
};

describe("toStoredAthleteQuestion", () => {
  it("joins an answer to the current question version", () => {
    expect(toStoredAthleteQuestion(question, answer)).toEqual({
      ...question,
      answer: "Strong until the last 3 km.",
      skipped: false,
      answeredAt: updatedAt,
    });
  });

  it("reports an unanswered question as null", () => {
    expect(toStoredAthleteQuestion(question, null)).toEqual({
      ...question,
      answer: null,
      skipped: false,
      answeredAt: null,
    });
  });

  it("marks a stored null answer as an explicit skip", () => {
    expect(
      toStoredAthleteQuestion(question, {
        ...answer,
        answer: null,
      }),
    ).toEqual({
      ...question,
      answer: null,
      skipped: true,
      answeredAt: updatedAt,
    });
  });
});

describe("answersMatchCurrentQuestions", () => {
  it("accepts an answer to the current version of an active question", () => {
    expect(answersMatchCurrentQuestions([question], [submitted])).toBe(true);
  });

  it("accepts an empty submission", () => {
    expect(answersMatchCurrentQuestions([question], [])).toBe(true);
  });

  it("rejects an unknown question", () => {
    expect(
      answersMatchCurrentQuestions([], [{ ...submitted, questionId: 999 }]),
    ).toBe(false);
  });

  it("rejects a superseded version", () => {
    expect(
      answersMatchCurrentQuestions(
        [question],
        [{ ...submitted, versionId: 10 }],
      ),
    ).toBe(false);
  });

  it("rejects a version that belongs to a different question", () => {
    const other: StoredQuestion = { ...question, id: 8, versionId: 99 };

    expect(
      answersMatchCurrentQuestions(
        [question, other],
        [{ ...submitted, versionId: 99 }],
      ),
    ).toBe(false);
  });

  it("rejects the same question twice", () => {
    expect(
      answersMatchCurrentQuestions([question], [submitted, submitted]),
    ).toBe(false);
  });

  it("rejects skipping a required question", () => {
    expect(
      answersMatchCurrentQuestions(
        [question],
        [{ ...submitted, answer: null }],
      ),
    ).toBe(false);
  });

  it("accepts skipping an optional question", () => {
    const optional: StoredQuestion = { ...question, required: false };

    expect(
      answersMatchCurrentQuestions(
        [optional],
        [{ ...submitted, answer: null }],
      ),
    ).toBe(true);
  });
});
