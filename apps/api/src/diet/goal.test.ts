import { describe, expect, it } from "bun:test";
import type { DietPlan } from "@killingit/shared";
import { isDietGoalProvided } from "./goal.js";

function diet(goal: string, goalProvided?: boolean): DietPlan {
  return { goal, goalProvided, assessment: "" };
}

describe("isDietGoalProvided", () => {
  it("reports no answer when no diet goal is stored", () => {
    expect(isDietGoalProvided(null)).toBeUndefined();
    expect(isDietGoalProvided(undefined)).toBeUndefined();
  });

  it("trusts the stored flag over the goal wording", () => {
    expect(isDietGoalProvided(diet("Maintain current weight", true))).toBe(
      true,
    );
    expect(isDietGoalProvided(diet("Lose 3 kg", false))).toBe(false);
  });

  it("infers the default goal from its wording, including punctuation", () => {
    expect(isDietGoalProvided(diet("Maintain current weight."))).toBe(false);
    expect(isDietGoalProvided(diet(" maintain current weight. "))).toBe(false);
  });

  it("infers a stated goal from custom wording", () => {
    expect(isDietGoalProvided(diet("Lose 3 kg by March"))).toBe(true);
    expect(isDietGoalProvided(diet("Hold 78 kg while building strength"))).toBe(
      true,
    );
  });
});
