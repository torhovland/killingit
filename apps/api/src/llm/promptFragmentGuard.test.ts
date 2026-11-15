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
 * Modules that legitimately build a provider-level message instead of the
 * text-only prompt message `systemUserMessages` returns. A repair appends an
 * assistant turn, a meal analysis attaches an image, and the provider module
 * defines the wider type. Add a module here only with the reason it cannot use
 * the shared builder.
 */
const PROVIDER_MESSAGE_MODULES: ReadonlySet<string> = new Set([
  // Attaches the meal photo as a content part.
  "foodPrompt.ts",
  // Defines the provider message type.
  "openrouter.ts",
  // Appends the rejected answer and the corrective turn.
  "planCompletion.ts",
]);

/** A hand-written message role, at either the prompt or the provider level. */
const MESSAGE_ROLE = /\brole:\s*"(?:system|user|assistant)"/;

/** The inline prompt message type the shared `LlmMessage` replaced. */
const INLINE_MESSAGE_TYPE = /\brole:\s*"system"\s*\|\s*"user"\s*;/;

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

  it("declares the prompt message type in promptRules alone", () => {
    const offenders = PROMPT_MODULES.filter((module) =>
      INLINE_MESSAGE_TYPE.test(normalizedSource(module)),
    );

    expect(offenders).toEqual([]);
  });

  it("builds every text prompt with the shared message builder", () => {
    const offenders = PROMPT_MODULES.filter(
      (module) =>
        !PROVIDER_MESSAGE_MODULES.has(module) &&
        MESSAGE_ROLE.test(normalizedSource(module)),
    );

    expect(offenders).toEqual([]);
  });

  it("keeps every provider-message exception in use", () => {
    const stale = [...PROVIDER_MESSAGE_MODULES.keys()].filter(
      (module) => !MESSAGE_ROLE.test(normalizedSource(module)),
    );

    expect(stale).toEqual([]);
  });
});
