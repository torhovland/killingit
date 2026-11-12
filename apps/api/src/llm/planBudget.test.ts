import { describe, expect, it } from "bun:test";
import {
  ANALYSIS_MAX_TOKENS,
  COMPLETION_BUDGET_MS,
  MAX_COMPLETION_ATTEMPTS,
  MAX_COMPLETION_TOKENS,
  PLAN_LEVEL_MAX_COMPLETIONS,
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

describe("completion budget", () => {
  it("caps one completion and one plan level", () => {
    expect(MAX_COMPLETION_ATTEMPTS).toBe(4);
    expect(PLAN_LEVEL_MAX_COMPLETIONS).toBe(6);
    expect(COMPLETION_BUDGET_MS).toBe(300_000);
  });

  it("lets a plan level finish one full ladder before it must repair", () => {
    expect(PLAN_LEVEL_MAX_COMPLETIONS).toBeGreaterThan(MAX_COMPLETION_ATTEMPTS);
  });
});
