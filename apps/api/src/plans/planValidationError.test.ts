import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PLAN_FAILED_MESSAGE, planFailureMessage } from "./failure.js";
import { PlanValidationError } from "./planValidationError.js";

/**
 * Guards `docs/specs/plan-validation-errors.md`. A rejected plan's reason ends
 * with the same instruction to regenerate, so the helper owns that sentence;
 * a check that writes it by hand drifts from the others and can omit it.
 */
const API_SRC = join(import.meta.dir, "..");
const HELPER = join(import.meta.dir, "planValidationError.ts");
const REGENERATE_INSTRUCTION = "Please regenerate the plan.";

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return productionFiles(path);
    }
    if (!/\.ts$/.test(entry.name) || /\.test\.ts$/.test(entry.name)) {
      return [];
    }
    return [path];
  });
}

describe("PlanValidationError", () => {
  it("appends the shared instruction to the reason", () => {
    const error = new PlanValidationError(
      "The coach returned a season that does not cover today.",
    );

    expect(error.message).toBe(
      "The coach returned a season that does not cover today. Please regenerate the plan.",
    );
    expect(error.name).toBe("PlanValidationError");
  });

  it("keeps the generic failure reason, because a plan fault is not the athlete's", () => {
    const message = planFailureMessage(
      new PlanValidationError("The coach returned a week for the wrong date."),
    );

    expect(message).toBe(PLAN_FAILED_MESSAGE);
  });

  it("is the only module that spells out the instruction", () => {
    const offenders = productionFiles(API_SRC)
      .filter((path) => path !== HELPER)
      .filter((path) =>
        readFileSync(path, "utf8").includes(REGENERATE_INSTRUCTION),
      )
      .map((path) => relative(API_SRC, path));

    expect(offenders).toEqual([]);
  });
});
