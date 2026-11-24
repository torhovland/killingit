import { describe, expect, it } from "bun:test";
import { startOfWeek } from "@killingit/shared";
import {
  MAX_COMPLETION_TOKENS,
  PLAN_MAX_TOKENS,
  RESCUE_COMPLETION_TOKENS,
} from "../../../apps/api/src/llm/planBudget.js";
import { promptRuleLiteral } from "../../../apps/api/src/testFixtures/prompts.js";
import {
  DAY_CONTRACT,
  GLOBAL_PROMPT_RULES,
  PLAN_PROMPT_RULES,
  SEASON_BLOCK_RULES,
  TRAINING_LOAD_RULES,
  WEEK_CONTRACT,
} from "../../../apps/api/src/llm/promptRules.js";
import { parseCurrentBlock } from "./promptBenchmark.js";
import {
  BENCHMARK_PROMPTS,
  benchmarkAttempts,
  buildBenchmarkPromptMessages,
  formatBenchmarkPrompt,
  REVISE_SEASON_DATE,
  REVISE_WEEK_START,
  TODAY_BENCHMARK_DATE,
} from "./promptBenchmarkInput.js";

const today = formatBenchmarkPrompt(buildBenchmarkPromptMessages("today"));
const reviseSeason = formatBenchmarkPrompt(
  buildBenchmarkPromptMessages("reviseSeason"),
);

describe("benchmark prompts", () => {
  it("builds both prompts from the app's current plan rules", () => {
    expect(today).toContain(GLOBAL_PROMPT_RULES);
    expect(today).toContain(PLAN_PROMPT_RULES);
    expect(today).toContain(promptRuleLiteral("WEEK_OUTLINE_RULES"));
    expect(today).toContain(promptRuleLiteral("BIKE_WORKOUT_RULES"));
    expect(today).toContain(TRAINING_LOAD_RULES);
    expect(today).toContain(DAY_CONTRACT);
    expect(today).toContain(WEEK_CONTRACT);
    expect(reviseSeason).toContain(GLOBAL_PROMPT_RULES);
    expect(reviseSeason).toContain(PLAN_PROMPT_RULES);
    expect(reviseSeason).toContain(SEASON_BLOCK_RULES);
  });

  /**
   * The app gives every plan level its plan budget and walks one reasoning
   * fallback ladder from it. A benchmark prompt with a smaller ceiling or no
   * reasoning control truncates models and records a coaching failure the app
   * itself would not produce.
   */
  it("walks the app's plan budget and reasoning ladder", () => {
    for (const definition of BENCHMARK_PROMPTS) {
      expect(definition.maxTokens).toBe(PLAN_MAX_TOKENS);
      expect(benchmarkAttempts(definition)).toEqual([
        { maxTokens: PLAN_MAX_TOKENS, reasoning: { effort: "minimal" } },
        { maxTokens: PLAN_MAX_TOKENS, reasoning: { effort: "none" } },
        { maxTokens: MAX_COMPLETION_TOKENS },
        { maxTokens: RESCUE_COMPLETION_TOKENS },
      ]);
    }
  });

  it("sends the system prompt and the user prompt the app sends", () => {
    for (const definition of BENCHMARK_PROMPTS) {
      const messages = buildBenchmarkPromptMessages(definition.id);
      expect(messages[0]?.role).toBe("system");
      expect(messages.at(-1)?.role).toBe("user");
    }
  });

  it("plans the dates the validators check", () => {
    expect(startOfWeek(TODAY_BENCHMARK_DATE)).toBe(REVISE_WEEK_START);
    expect(startOfWeek(REVISE_SEASON_DATE)).toBe(REVISE_WEEK_START);
    expect(today).toContain(`Today's date: ${TODAY_BENCHMARK_DATE}`);
    expect(today).toContain("make sure one session has the date 2026-10-30");
    expect(reviseSeason).toContain(`Today's date: ${REVISE_SEASON_DATE}`);
    expect(reviseSeason).toContain(
      "make sure one session has the date 2026-11-01",
    );
  });

  it("supplies the current block the revision gates compare against", () => {
    const baseline = parseCurrentBlock(reviseSeason);
    expect(baseline?.startDate).toBe("2026-10-19");
    expect(baseline?.weeks).toHaveLength(7);
    expect(baseline?.weeks[0]?.startDate).toBe("2026-10-19");
  });

  it("puts the Atlas goal in the revision the coach has to absorb", () => {
    expect(reviseSeason).toContain("Atlas Mountain Race on 28 February 2027");
  });

  /**
   * The snapshot is the benchmark input. A change to any prompt rule, contract
   * or fixture changes it, so a stale benchmark prompt cannot pass CI unnoticed.
   * Update it deliberately with `bun test --update-snapshots` and review the
   * diff.
   */
  it("matches the committed benchmark-input snapshot", () => {
    expect(today).toMatchSnapshot();
    expect(reviseSeason).toMatchSnapshot();
  });
});
