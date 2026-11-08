import { describe, expect, it } from "bun:test";
import {
  ANALYSIS_MAX_TOKENS,
  MAX_COMPLETION_TOKENS,
  PLAN_MAX_TOKENS,
} from "./planBudget.js";

describe("plan output budget", () => {
  it("leaves room for reasoning plus the largest plan response", () => {
    expect(PLAN_MAX_TOKENS).toBe(16_384);
    expect(MAX_COMPLETION_TOKENS).toBeGreaterThan(PLAN_MAX_TOKENS);
  });

  it("gives a short analysis the same room so it need not fall back", () => {
    expect(ANALYSIS_MAX_TOKENS).toBe(16_384);
  });
});
