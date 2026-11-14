import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Guards `docs/specs/api-errors.md` and ADR 0038. A route answers a failure with
 * the shared contract, a provider failure through `respondUpstreamError`, or a
 * generic reason through `athleteFailureMessage`. It never reads a caught
 * error's own `message`, because that can name a database table or an
 * environment secret and would reach the athlete's screen or a stored
 * explanation. A route logs the error object itself instead.
 */
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const ROUTES = join(REPO_ROOT, "apps", "api", "src", "routes");
const RAW_ERROR_MESSAGE = /\b(?:err|error|cause)\b[^;\n]*?\.message\b/;

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

describe("route error messages", () => {
  it("scans the route modules, so the guard cannot pass vacuously", () => {
    expect(productionFiles(ROUTES).length).toBeGreaterThan(10);
  });

  it("never reads a caught error's message", () => {
    const offenders = productionFiles(ROUTES)
      .filter((path) => RAW_ERROR_MESSAGE.test(readFileSync(path, "utf8")))
      .map((path) => relative(REPO_ROOT, path));

    expect(offenders).toEqual([]);
  });
});
