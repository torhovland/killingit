import { describe, expect, it } from "bun:test";
import { PLAN_GENERATION_START, PLAN_GENERATION_STEPS } from "./steps.js";

/** The full build path, in the order the generation runs its steps. */
const FULL_BUILD = [
  PLAN_GENERATION_STEPS.syncActivities,
  PLAN_GENERATION_STEPS.prepare,
  PLAN_GENERATION_STEPS.review,
  PLAN_GENERATION_STEPS.season,
  PLAN_GENERATION_STEPS.initialBlock,
  PLAN_GENERATION_STEPS.initialWeek,
  PLAN_GENERATION_STEPS.day,
  PLAN_GENERATION_STEPS.planUpdate,
  PLAN_GENERATION_STEPS.save,
];

/** A cascade that starts at the block, without the full-build prefix. */
const CASCADE = [
  PLAN_GENERATION_STEPS.syncActivities,
  PLAN_GENERATION_STEPS.prepare,
  PLAN_GENERATION_STEPS.planUpdate,
  PLAN_GENERATION_STEPS.save,
];

describe("plan generation steps", () => {
  it("names the Garmin sync before plan preparation", () => {
    expect(PLAN_GENERATION_STEPS.syncActivities.label).toBe(
      "Syncing Garmin activities",
    );
    expect(PLAN_GENERATION_STEPS.syncActivities.target).toBeLessThan(
      PLAN_GENERATION_STEPS.prepare.target,
    );
  });

  it("never moves the bar backwards along the full build", () => {
    let previous = PLAN_GENERATION_START;
    for (const step of FULL_BUILD) {
      expect(step.target).toBeGreaterThan(previous);
      previous = step.target;
    }
  });

  it("never moves the bar backwards along a cascade", () => {
    let previous = PLAN_GENERATION_START;
    for (const step of CASCADE) {
      expect(step.target).toBeGreaterThan(previous);
      previous = step.target;
    }
  });

  it("leaves room for completion while the run is still going", () => {
    for (const step of Object.values(PLAN_GENERATION_STEPS)) {
      expect(step.target).toBeLessThanOrEqual(99);
      expect(step.defaultMs).toBeGreaterThan(0);
    }
  });
});
