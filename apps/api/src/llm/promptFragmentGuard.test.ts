import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promptRulesProse } from "../testFixtures/prompts.js";

/**
 * Guards the rule in `AGENTS.md` that a reusable prompt fragment lives in
 * `promptRules.ts`. A prompt module composes the fragment it needs; when it
 * spells the same prose out again the two copies drift apart, and the coach
 * starts receiving two versions of one rule.
 *
 * The prose is read out of the module's source rather than its exports, because
 * a fragment used only inside `promptRules.ts` is not exported.
 *
 * The scan covers the plan-update prompts this rule was applied to. Widening it
 * to every `apps/api/src/llm/*Prompt.ts` waits for the last copies elsewhere,
 * which issue #367 tracks.
 */
const LLM_DIR = import.meta.dir;
const PROMPT_MODULES = ["planUpdate.ts", "planUpdatePrompt.ts"];

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

  it("is composed in the plan-update prompts instead of repeated", () => {
    const fragments = promptRulesProse();
    const offenders = PROMPT_MODULES.flatMap((module) => {
      const source = normalizedSource(module);
      return fragments
        .filter((fragment) => source.includes(fragment))
        .map((fragment) => `${module} repeats "${fragment}"`);
    });

    expect(offenders).toEqual([]);
  });
});
