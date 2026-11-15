import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Guards the rule that a coaching survey adjustment has one shape and one
 * writer. `questions/adjustments.ts` declares the snapshot type and owns every
 * insert, so the survey save builds the snapshot and appends it through
 * `CoachingSurveyAdjustmentStore`. A copied shape or a second insert lets the
 * store, the survey save and the plan prompt drift apart. See issue #273.
 */
const API_SRC_DIR = join(import.meta.dir, "..");
const ADJUSTMENTS_MODULE = "questions/adjustments.ts";

/** A declared snapshot field, spelled only the way a type declaration does. */
const ADJUSTMENT_FIELD =
  /^\s*previous(?:Question|Answer)\??:\s*string \| null;/m;

/** A snapshot row written straight to the table instead of the store. */
const ADJUSTMENT_INSERT = /\.insert\(coachingSurveyAdjustments\)/;

function productionSources(dir: string): Map<string, string> {
  const sources = new Map<string, string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [file, source] of productionSources(path)) {
        sources.set(file, source);
      }
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      sources.set(relative(API_SRC_DIR, path), readFileSync(path, "utf8"));
    }
  }
  return sources;
}

const SOURCES = productionSources(API_SRC_DIR);

describe("coaching survey adjustments", () => {
  it("declares the snapshot fields in adjustments.ts, so the scan cannot pass vacuously", () => {
    expect(SOURCES.get(ADJUSTMENTS_MODULE)).toMatch(ADJUSTMENT_FIELD);
  });

  it("declares one adjustment shape across the API", () => {
    const offenders = [...SOURCES]
      .filter(
        ([file, source]) =>
          file !== ADJUSTMENTS_MODULE && ADJUSTMENT_FIELD.test(source),
      )
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });

  it("appends every adjustment through the store", () => {
    const offenders = [...SOURCES]
      .filter(
        ([file, source]) =>
          file !== ADJUSTMENTS_MODULE && ADJUSTMENT_INSERT.test(source),
      )
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });
});
