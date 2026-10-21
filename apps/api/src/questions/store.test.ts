import { describe, expect, it } from "bun:test";
import type { QuestionRow, QuestionVersionRow } from "../db/schema.js";
import { toStoredQuestion } from "./store.js";

const createdAt = new Date("2026-10-20T09:00:00.000Z");
const updatedAt = new Date("2026-10-20T10:00:00.000Z");

const question: QuestionRow = {
  id: 7,
  currentVersion: 2,
  createdAt,
  updatedAt,
  archivedAt: null,
};

const currentVersion: QuestionVersionRow = {
  id: 11,
  questionId: 7,
  version: 2,
  prompt: "How did the long run feel?",
  required: false,
  createdAt: updatedAt,
};

describe("toStoredQuestion", () => {
  it("maps a question row and its current version to the stored shape", () => {
    expect(toStoredQuestion(question, currentVersion, 2)).toEqual({
      id: 7,
      versionId: 11,
      prompt: "How did the long run feel?",
      required: false,
      version: 2,
      versionCount: 2,
      createdAt,
      updatedAt,
    });
  });
});
