import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  promptRuleLiteral,
  promptRulesProse,
} from "../testFixtures/prompts.js";

/**
 * Guards the rule in `AGENTS.md` that a reusable prompt fragment lives in
 * `promptRules.ts`. A prompt module composes the fragment it needs; when it
 * spells the same prose out again the two copies drift apart, and the coach
 * starts receiving two versions of one rule.
 *
 * The scan covers every module under `llm/`, plus the manual TSS prompt under
 * `training/`. The prose is read out of the module's source rather than its
 * exports, because a fragment used only inside `promptRules.ts` is not exported.
 */
const LLM_DIR = import.meta.dir;
const PROMPT_MODULES = [
  ...readdirSync(LLM_DIR)
    .filter(
      (file) =>
        file.endsWith(".ts") &&
        !file.endsWith(".test.ts") &&
        file !== "promptRules.ts",
    )
    .sort(),
  "../training/manualTss.ts",
];

/**
 * A module's source with its quote escapes resolved, so the same sentence
 * matches whichever quote style it is written in.
 */
function normalizedSource(module: string): string {
  return readFileSync(join(LLM_DIR, module), "utf8")
    .replaceAll('\\"', '"')
    .replaceAll("\\'", "'");
}

describe("shared prompt fragments", () => {
  it("finds the prose promptRules owns, so the scan cannot pass vacuously", () => {
    expect(promptRulesProse().length).toBeGreaterThan(0);
  });

  it("is composed in every llm module instead of repeated", () => {
    const fragments = promptRulesProse();
    const offenders = PROMPT_MODULES.flatMap((module) => {
      const source = normalizedSource(module);
      return fragments
        .filter((fragment) => source.includes(fragment))
        .map((fragment) => `${module} repeats "${fragment}"`);
    });

    expect(offenders).toEqual([]);
  });

  it("keeps the JSON-shape instruction in promptRules alone", () => {
    const instruction = promptRuleLiteral("JSON_SHAPE_INSTRUCTION");
    const offenders = PROMPT_MODULES.filter((module) =>
      normalizedSource(module).includes(instruction),
    );

    expect(offenders).toEqual([]);
  });
});
