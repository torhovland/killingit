import { describe, expect, it } from "bun:test";
import {
  isSameCoachQuestion,
  normalizeCoachQuestion,
} from "./coachQuestions.js";

describe("normalizeCoachQuestion", () => {
  it("ignores case, punctuation and filler words", () => {
    expect(
      normalizeCoachQuestion(
        "What are the start and end dates for Paris-Brest-Paris?",
      ),
    ).toBe("start end dates paris brest paris");
  });
});

describe("isSameCoachQuestion", () => {
  it("treats two wordings of the same event question as the same", () => {
    expect(
      isSameCoachQuestion(
        "What are your start and end dates for Paris-Brest-Paris in August 2027?",
        "What are the start and end dates for your Paris-Brest-Paris event in August 2027?",
      ),
    ).toBe(true);
  });

  it("keeps questions about different events apart", () => {
    expect(
      isSameCoachQuestion(
        "What are the dates for Paris-Brest-Paris?",
        "What are the dates for the Oslo Marathon?",
      ),
    ).toBe(false);
  });

  it("keeps questions about different measures apart", () => {
    expect(
      isSameCoachQuestion(
        "Which sport is your FTP for?",
        "Which sport is your threshold pace for?",
      ),
    ).toBe(false);
  });

  it("matches the same question with different casing and punctuation", () => {
    expect(
      isSameCoachQuestion(
        "Was your 24 October strength session painful?",
        "was your 24 october strength session painful",
      ),
    ).toBe(true);
  });
});
