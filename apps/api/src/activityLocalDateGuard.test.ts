import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Guards `docs/specs/activity-local-date.md`. An activity's `startDate` is an
 * ISO UTC instant, so its first ten characters are the UTC date, not the
 * athlete's. Every production day must come from `activityLocalDate`, and this
 * scan fails when the old shortcut comes back.
 */
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const SOURCE_ROOTS = [
  join(REPO_ROOT, "apps", "api", "src"),
  join(REPO_ROOT, "apps", "web", "src"),
];
const UTC_PREFIX = /startDate\.slice\(\s*0\s*,\s*10\s*\)/;

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return productionFiles(path);
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
      return [];
    }
    return [path];
  });
}

describe("activity local date", () => {
  it("never derives a day from an activity's UTC timestamp prefix", () => {
    const offenders = SOURCE_ROOTS.flatMap(productionFiles)
      .filter((path) => UTC_PREFIX.test(readFileSync(path, "utf8")))
      .map((path) => relative(REPO_ROOT, path));

    expect(offenders).toEqual([]);
  });
});
