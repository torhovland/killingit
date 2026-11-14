import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Guards `docs/specs/route-param-validation.md`. Every route path parameter is
 * validated by the shared `zValidator("param", ...)` and read through
 * `c.req.valid("param")`, so an invalid id answers the shared error contract
 * instead of reaching a query. This scan fails when a route parses one by hand.
 */
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const ROUTES = join(REPO_ROOT, "apps", "api", "src", "routes");
const HAND_PARSED_PARAM = /c\.req\.param\s*\(/;

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

describe("route path parameters", () => {
  it("never reads a path parameter without the shared validator", () => {
    const offenders = productionFiles(ROUTES)
      .filter((path) => HAND_PARSED_PARAM.test(readFileSync(path, "utf8")))
      .map((path) => relative(REPO_ROOT, path));

    expect(offenders).toEqual([]);
  });
});
