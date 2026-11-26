import { describe, expect, it } from "bun:test";
import {
  ANALYSIS_TEMPERATURE,
  COACH_REPLY_TEMPERATURE,
  PLAN_TEMPERATURE,
  REPAIR_TEMPERATURE,
} from "./sampling.js";

describe("coach sampling temperatures", () => {
  it("gives conversational answers more variety than a plan", () => {
    expect(COACH_REPLY_TEMPERATURE).toBeGreaterThan(PLAN_TEMPERATURE);
    expect(COACH_REPLY_TEMPERATURE).toBeGreaterThanOrEqual(0.7);
  });

  it("lets activity and period reviews vary more than a repair", () => {
    expect(ANALYSIS_TEMPERATURE).toBeGreaterThan(REPAIR_TEMPERATURE);
    expect(ANALYSIS_TEMPERATURE).toBeLessThan(COACH_REPLY_TEMPERATURE);
  });
});
