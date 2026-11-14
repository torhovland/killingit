import { describe, expect, it } from "bun:test";
import { commentIsNewerThanAnalysis } from "../analysisFreshness.js";

describe("commentIsNewerThanAnalysis", () => {
  const generatedAt = new Date("2026-10-22T09:00:00Z");

  it("regenerates an analysis older than the comment", () => {
    expect(
      commentIsNewerThanAnalysis(
        { generatedAt },
        new Date("2026-10-22T10:00:00Z"),
      ),
    ).toBe(true);
  });

  it("keeps an analysis produced after the comment", () => {
    expect(
      commentIsNewerThanAnalysis(
        { generatedAt },
        new Date("2026-10-22T08:00:00Z"),
      ),
    ).toBe(false);
  });

  it("keeps an analysis when there is no comment", () => {
    expect(commentIsNewerThanAnalysis({ generatedAt }, null)).toBe(false);
    expect(commentIsNewerThanAnalysis(undefined, new Date())).toBe(false);
  });
});
