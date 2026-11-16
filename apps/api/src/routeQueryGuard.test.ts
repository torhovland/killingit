import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Guards `docs/specs/api-query-validation.md`. Every route that needs the
 * athlete's local date validates it through the shared `todayQuerySchema` and
 * reads `c.req.valid("query")`, so an invalid date answers the shared error
 * contract instead of a route-specific message. This scan fails when a route
 * parses `today` by hand.
 */
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const ROUTES = join(REPO_ROOT, "apps", "api", "src", "routes");
const HAND_PARSED_TODAY =
  /c\.req\.query\(\s*["']today["']\s*\)|planDateSchema\.safeParse/;
/**
 * A query flag belongs in a route's `zValidator("query", ...)` schema too: the
 * handler reads the coerced boolean through `c.req.valid("query")`, so an
 * unknown value fails validation instead of silently meaning false.
 */
const HAND_PARSED_QUERY_FLAG =
  /c\.req\.query\([^)]*\)\s*(?:===|!==|==|!=)\s*["']|Boolean\(\s*c\.req\.query\(/;

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

describe("route query today", () => {
  it("never parses today without the shared query schema", () => {
    const offenders = productionFiles(ROUTES)
      .filter((path) => HAND_PARSED_TODAY.test(readFileSync(path, "utf8")))
      .map((path) => relative(REPO_ROOT, path));

    expect(offenders).toEqual([]);
  });

  it("allows a schema to compose today from the shared date schema", () => {
    // Composing a query object is not a hand parse; only reading the request
    // query or running `safeParse` in a handler is.
    expect(HAND_PARSED_TODAY.test("today: planDateSchema.optional()")).toBe(
      false,
    );
  });
});

describe("route query flags", () => {
  it("never coerces a query flag without the shared query schema", () => {
    const offenders = productionFiles(ROUTES)
      .filter((path) => HAND_PARSED_QUERY_FLAG.test(readFileSync(path, "utf8")))
      .map((path) => relative(REPO_ROOT, path));

    expect(offenders).toEqual([]);
  });

  it("allows the shared boolean schema in a query object", () => {
    expect(
      HAND_PARSED_QUERY_FLAG.test("includeTomorrow: booleanQuerySchema"),
    ).toBe(false);
  });
});
