import { describe, expect, it } from "bun:test";
import { athleteTextChanged } from "./athleteText.js";

const planGeneratedAt = new Date("2026-11-01T09:00:00Z");
const before = new Date("2026-10-31T09:00:00Z");
const after = new Date("2026-11-02T09:00:00Z");

function state(
  overrides: Partial<Parameters<typeof athleteTextChanged>[0]> = {},
) {
  return {
    planGeneratedAt,
    planAnswersUpdatedAt: before,
    planCoachingInputsUpdatedAt: before,
    answers: [{ answeredAt: before }],
    coachingInputsUpdatedAt: before,
    coachAnswers: [],
    ...overrides,
  };
}

describe("athleteTextChanged", () => {
  it("reads on a first build", () => {
    expect(athleteTextChanged(state({ planGeneratedAt: null }))).toBe(true);
  });

  it("does not read again when nothing the athlete wrote has changed", () => {
    expect(athleteTextChanged(state())).toBe(false);
  });

  it("reads when a profile answer is newer than the plan", () => {
    expect(
      athleteTextChanged(state({ answers: [{ answeredAt: after }] })),
    ).toBe(true);
  });

  it("reads when a coaching input is newer than the plan", () => {
    expect(athleteTextChanged(state({ coachingInputsUpdatedAt: after }))).toBe(
      true,
    );
  });

  it("reads when an answer to a coach question is newer than the plan", () => {
    expect(
      athleteTextChanged(
        state({
          coachAnswers: [{ answeredAt: after.toISOString() }],
        }),
      ),
    ).toBe(true);
  });

  it("does not read for an answer the plan already included", () => {
    expect(
      athleteTextChanged(state({ coachAnswers: [{ answeredAt: before }] })),
    ).toBe(false);
  });
});
