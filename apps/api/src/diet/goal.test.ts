import { describe, expect, it } from "bun:test";
import { isDefaultDietGoal } from "./goal.js";

describe("isDefaultDietGoal", () => {
  it("recognises the default wording, including punctuation", () => {
    expect(isDefaultDietGoal("Maintain current weight")).toBe(true);
    expect(isDefaultDietGoal(" maintain current weight. ")).toBe(true);
    expect(isDefaultDietGoal(null)).toBe(true);
    expect(isDefaultDietGoal(undefined)).toBe(true);
  });

  it("treats a stated goal as custom", () => {
    expect(isDefaultDietGoal("Lose 3 kg by March")).toBe(false);
    expect(isDefaultDietGoal("Hold 78 kg while building strength")).toBe(false);
  });
});
