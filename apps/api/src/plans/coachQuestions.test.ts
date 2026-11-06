import { describe, expect, it } from "bun:test";
import { newestCoachQuestion } from "./coachQuestions.js";

describe("newestCoachQuestion", () => {
  it("keeps only the last non-blank question", () => {
    expect(newestCoachQuestion([" first ", "second", "   "])).toBe("second");
  });

  it("returns null when the response carries no question", () => {
    expect(newestCoachQuestion(["", "   "])).toBeNull();
  });
});
