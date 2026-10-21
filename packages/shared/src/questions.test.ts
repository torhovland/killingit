import { describe, expect, it } from "bun:test";
import {
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
