import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Cloudflare Pages reads `_headers` from the build output (Vite copies it from
 * `public/`). These assertions guard the cache policy in
 * `docs/specs/web-cache-busting.md`, not the platform itself.
 */
const source = readFileSync(
  join(import.meta.dir, "..", "public", "_headers"),
  "utf8",
);

interface Rule {
  pattern: string;
  headers: string[];
}

function parseRules(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    // A rule pattern starts at column 0; its headers are indented.
    if (raw === line) {
      rules.push({ pattern: line, headers: [] });
      continue;
    }
    rules.at(-1)?.headers.push(line);
  }
  return rules;
}

function ruleFor(pattern: string): Rule | undefined {
  return parseRules(source).find((rule) => rule.pattern === pattern);
}

describe("Cloudflare Pages cache headers", () => {
  it("revalidates the app shell on every visit", () => {
    const shell = ruleFor("/*");

    expect(shell?.headers).toContain("Cache-Control: no-cache");
    expect(shell?.headers.some((h) => /immutable|max-age=[1-9]/.test(h))).toBe(
      false,
    );
  });

  it("caches fingerprinted assets forever and drops the shell rule", () => {
    const assets = ruleFor("/assets/*");

    expect(assets?.headers).toEqual([
      "! Cache-Control",
      "Cache-Control: public, max-age=31536000, immutable",
    ]);
  });
});
