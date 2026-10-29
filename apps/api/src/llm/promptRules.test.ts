import { describe, expect, it } from "bun:test";
import { COACH_RESPONSE_NOTES_RULES } from "./promptRules.js";

describe("COACH_RESPONSE_NOTES_RULES", () => {
  it("asks for at most one question per response", () => {
    expect(COACH_RESPONSE_NOTES_RULES).toContain(
      "Ask at most one question per response",
    );
    expect(COACH_RESPONSE_NOTES_RULES).toContain(
      "never one question per activity, day, week, block or season level",
    );
  });

  it("asks the question to name its context", () => {
    expect(COACH_RESPONSE_NOTES_RULES).toContain(
      "specific and self-contained by naming the activity, date, week or metric",
    );
    expect(COACH_RESPONSE_NOTES_RULES).toContain("12 October endurance ride");
  });
});
