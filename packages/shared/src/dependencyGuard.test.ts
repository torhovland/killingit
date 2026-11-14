import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Guards ADR 0055. `packages/shared` holds the wire contract and the helpers
 * both sides use, so it must stay independent of the API and of any
 * server-side runtime module. A shared module may import a sibling module or
 * `zod`, and nothing else: a database driver, a web framework or a Node builtin
 * in this package means an API-only concern has leaked into the contract.
 */
const PACKAGE_DIR = import.meta.dir;
const REPO_ROOT = join(PACKAGE_DIR, "..", "..", "..");
const ALLOWED_MODULES: ReadonlySet<string> = new Set(["zod"]);
const IMPORT_SPECIFIER = /from\s+"([^"]+)"/g;

function sharedModules(): string[] {
  return readdirSync(PACKAGE_DIR, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile() || !/\.ts$/.test(entry.name)) {
      return [];
    }
    if (/\.test\.ts$/.test(entry.name)) {
      return [];
    }
    return [entry.name];
  });
}

describe("shared package dependencies", () => {
  it("imports only sibling modules and zod", () => {
    const offenders: string[] = [];

    for (const name of sharedModules()) {
      const source = readFileSync(join(PACKAGE_DIR, name), "utf8");
      for (const match of source.matchAll(IMPORT_SPECIFIER)) {
        const specifier = match[1];
        if (specifier === undefined) {
          continue;
        }
        if (ALLOWED_MODULES.has(specifier) || specifier.startsWith(".")) {
          continue;
        }
        offenders.push(
          `${relative(REPO_ROOT, join(PACKAGE_DIR, name))} imports "${specifier}"`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });
});
