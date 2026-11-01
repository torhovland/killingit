import { describe, expect, it } from "bun:test";
import type { QuestionAnswerInput } from "@killingit/shared";
import type { QuestionAnswerRow } from "../db/schema.js";
import {
  answersMatchCurrentQuestions,
  buildCoachingSurveyAdjustments,
  toStoredAthleteQuestion,
} from "./answers.js";
import type { StoredQuestion, StoredQuestionWithVersions } from "./store.js";

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
      previous: null,
    });
  });

  it("reports an unanswered question as null", () => {
    expect(toStoredAthleteQuestion(question, null)).toEqual({
      ...question,
      answer: null,
      skipped: false,
      answeredAt: null,
      previous: null,
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
      previous: null,
    });
  });

  it("carries the newest earlier answer as the previous response", () => {
    const previousAnswer: QuestionAnswerRow = {
      ...answer,
      id: 2,
      questionVersionId: 10,
      answer: "It felt hard.",
      updatedAt: new Date("2026-10-19T08:00:00Z"),
    };

    expect(
      toStoredAthleteQuestion(question, null, {
        version: {
          versionId: 10,
          version: 1,
          prompt: "How did the long run feel?",
          required: true,
        },
        answer: previousAnswer,
      }),
    ).toEqual({
      ...question,
      answer: null,
      skipped: false,
      answeredAt: null,
      previous: {
        versionId: 10,
        version: 1,
        prompt: "How did the long run feel?",
        answer: "It felt hard.",
        skipped: false,
        answeredAt: new Date("2026-10-19T08:00:00Z"),
      },
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

describe("buildCoachingSurveyAdjustments", () => {
  const withVersions: StoredQuestionWithVersions = {
    ...question,
    prompt: "How did the long run feel this time?",
    versions: [
      {
        versionId: 10,
        version: 1,
        prompt: "How did the long run feel?",
        required: true,
      },
      {
        versionId: 11,
        version: 2,
        prompt: "How did the long run feel this time?",
        required: true,
      },
    ],
  };

  it("records a newly answered question", () => {
    expect(
      buildCoachingSurveyAdjustments(
        [{ ...withVersions, versions: [withVersions.versions[1]!] }],
        new Map(),
        [submitted],
      ),
    ).toEqual([
      {
        question: "How did the long run feel this time?",
        previousQuestion: null,
        previousAnswer: null,
        answer: "Strong until the last 3 km.",
      },
    ]);
  });

  it("records an answer to a revised question with the earlier wording and answer", () => {
    expect(
      buildCoachingSurveyAdjustments(
        [withVersions],
        new Map([[10, { answer: "It felt hard." }]]),
        [submitted],
      ),
    ).toEqual([
      {
        question: "How did the long run feel this time?",
        previousQuestion: "How did the long run feel?",
        previousAnswer: "It felt hard.",
        answer: "Strong until the last 3 km.",
      },
    ]);
  });

  it("records an edited answer to the same version", () => {
    expect(
      buildCoachingSurveyAdjustments(
        [withVersions],
        new Map([[11, { answer: "It felt hard." }]]),
        [submitted],
      ),
    ).toEqual([
      {
        question: "How did the long run feel this time?",
        previousQuestion: "How did the long run feel this time?",
        previousAnswer: "It felt hard.",
        answer: "Strong until the last 3 km.",
      },
    ]);
  });

  it("ignores an unchanged resubmission", () => {
    expect(
      buildCoachingSurveyAdjustments(
        [withVersions],
        new Map([[11, { answer: "Strong until the last 3 km." }]]),
        [submitted],
      ),
    ).toEqual([]);
  });
});
