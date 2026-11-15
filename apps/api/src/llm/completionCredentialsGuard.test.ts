import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the rule that a completion takes one credentials type.
 * `CompletionCredentials` is declared in `resilientCompletion.ts`; a plan prompt
 * module that needs the api key, model and abort signal imports that type
 * instead of declaring a copy whose fields drift apart. See issue #263.
 *
 * The declaration is read out of the module's source rather than its exports,
 * because a copied type would still be exported and typecheck as identical.
 */
const LLM_DIR = import.meta.dir;
const PLAN_MODULES = ["planCompletion.ts", "planUpdate.ts"];
const CREDENTIALS_DECLARATION =
  /^(?:export )?(?:interface|type) \w*Credentials\b/m;

function source(module: string): string {
  return readFileSync(join(LLM_DIR, module), "utf8");
}

describe("completion credentials", () => {
  it("declares the type in resilientCompletion.ts, so the scan cannot pass vacuously", () => {
    expect(source("resilientCompletion.ts")).toMatch(
      /^export interface CompletionCredentials \{/m,
    );
  });

  it("is declared once instead of copied into the plan modules", () => {
    const offenders = PLAN_MODULES.filter((module) =>
      CREDENTIALS_DECLARATION.test(source(module)),
    );

    expect(offenders).toEqual([]);
  });
});
