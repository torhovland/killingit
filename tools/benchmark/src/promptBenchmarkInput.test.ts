import { describe, expect, it } from "bun:test";
import { startOfWeek } from "@killingit/shared";
import {
  BIKE_WORKOUT_RULES,
  CALORIE_BREAKDOWN_CONTRACT,
  DIET_PROGRESS_CONTRACT,
  FORM_TARGET_RULES,
  GLOBAL_PROMPT_RULES,
  PLAN_PROMPT_RULES,
  SEASON_BLOCK_RULES,
  WEEK_OUTLINE_RULES,
} from "../../../apps/api/src/llm/promptRules.js";
import { parseCurrentBlock } from "./promptBenchmark.js";
import {
  BENCHMARK_PROMPTS,
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
    expect(today).toContain(WEEK_OUTLINE_RULES);
    expect(today).toContain(BIKE_WORKOUT_RULES);
    expect(today).toContain(FORM_TARGET_RULES);
    expect(today).toContain(CALORIE_BREAKDOWN_CONTRACT);
    expect(today).toContain(DIET_PROGRESS_CONTRACT);
    expect(reviseSeason).toContain(GLOBAL_PROMPT_RULES);
    expect(reviseSeason).toContain(PLAN_PROMPT_RULES);
    expect(reviseSeason).toContain(SEASON_BLOCK_RULES);
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
