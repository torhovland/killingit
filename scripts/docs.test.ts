import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";

interface PackageManifest {
  scripts?: Record<string, string | undefined>;
}

const ROOT = path.resolve(import.meta.dir, "..");
const AGENTS = await Bun.file(path.join(ROOT, "AGENTS.md")).text();
const ROOT_PACKAGE = (await Bun.file(
  path.join(ROOT, "package.json"),
).json()) as PackageManifest;

/** An ADR file name: a zero-padded number, a slug and the Markdown suffix. */
const ADR_FILE = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

/** The unit-test runners the repository does not use. */
const FOREIGN_TEST_RUNNERS = /\b(?:vitest|jest|mocha)\b/i;

function markdownFiles(pattern: string): string[] {
  return [...new Bun.Glob(pattern).scanSync({ cwd: ROOT })].sort();
}

/**
 * A reference to a document under `docs/specs`, `docs/adrs` or `benchmarks`.
 * It may follow whitespace, a backtick or a Markdown link's opening bracket,
 * and a link may prefix it with `./`.
 */
function documentReferences(text: string): string[] {
  const pattern =
    /(?:^|[\s`(])((?:\.\/)?(?:docs\/(?:specs|adrs)|benchmarks)\/[A-Za-z0-9._/-]+)/g;
  return [...text.matchAll(pattern)].flatMap((match) => {
    const reference = match[1]?.replace(/[.,;:]+$/, "");
    return reference === undefined ? [] : [reference];
  });
}

/**
 * Whether a reference names a file. A directory such as
 * `benchmarks/prompts/runs/` is generated output and is absent from a fresh
 * checkout, and a placeholder such as `benchmarks/prompts/runs/<RUN_ID>` is
 * not a path at all.
 */
function namesFile(reference: string): boolean {
  if (/[<>*{}$]/.test(reference) || reference.endsWith("/")) {
    return false;
  }
  return (reference.split("/").at(-1) ?? "").includes(".");
}

const SPEC_FILES = markdownFiles("docs/specs/*.md");
const ADR_FILES = markdownFiles("docs/adrs/*.md");

/** The documents whose references point at specs, ADRs and benchmark files. */
const REFERENCE_TEXTS = await Promise.all(
  ["AGENTS.md", "README.md", ...SPEC_FILES].map((file) =>
    Bun.file(path.join(ROOT, file)).text(),
  ),
);

/** The spec paths AGENTS.md links, with any `./` prefix removed. */
const AGENTS_SPEC_REFERENCES = new Set(
  documentReferences(AGENTS).map((reference) => reference.replace(/^\.\//, "")),
);

const REFERENCES = [
  ...new Set(REFERENCE_TEXTS.flatMap(documentReferences).filter(namesFile)),
];

const MISSING_REFERENCES = REFERENCES.filter(
  (reference) => !existsSync(path.join(ROOT, reference)),
);

const ADR_NUMBERS = ADR_FILES.flatMap((file) => {
  const number = ADR_FILE.exec(path.basename(file))?.[1];
  return number === undefined ? [] : [Number(number)];
});

describe("document references", () => {
  it("reads the documents that carry references and finds some", () => {
    expect(REFERENCE_TEXTS.length).toBeGreaterThan(2);
    // One reference from each root, so a narrowed pattern cannot pass by
    // matching nothing.
    expect(REFERENCES).toContain("docs/specs/fitness-page.md");
    expect(REFERENCES).toContain(
      "docs/adrs/0001-hosting-cloud-run-neon-cloudflare.md",
    );
    expect(
      REFERENCES.some((reference) => reference.startsWith("benchmarks/")),
    ).toBe(true);
  });

  it("keeps every referenced spec, ADR and benchmark file on disk", () => {
    // A broken reference is how a renamed or deleted document goes unnoticed.
    expect(MISSING_REFERENCES).toEqual([]);
  });
});

describe("spec index", () => {
  it("links every spec from AGENTS.md", () => {
    // AGENTS.md is the agent's entry point: a spec the index omits is
    // effectively invisible, so every file under `docs/specs` is linked.
    const unlinked = SPEC_FILES.filter(
      (file) => !AGENTS_SPEC_REFERENCES.has(file),
    );
    expect(unlinked).toEqual([]);
  });
});

describe("ADR numbering", () => {
  it("names every ADR with a four-digit number and a slug", () => {
    expect(ADR_NUMBERS.length).toBe(ADR_FILES.length);
    expect(ADR_NUMBERS.length).toBeGreaterThan(0);
  });

  it("gives every ADR its own number, in monotonic order", () => {
    // The repository has historical gaps in its ADR numbers, so this asserts a
    // unique, increasing numbering rather than a gapless range.
    for (const [index, number] of ADR_NUMBERS.entries()) {
      if (index > 0) {
        expect(number).toBeGreaterThan(ADR_NUMBERS[index - 1] ?? 0);
      }
    }
  });
});

describe("test runner", () => {
  it("runs the root unit suite with Bun's test runner", () => {
    expect(ROOT_PACKAGE.scripts?.test).toContain("bun test");
  });

  it("names the same runner in AGENTS.md", () => {
    expect(AGENTS).toContain("bun:test");
    expect(AGENTS).not.toMatch(FOREIGN_TEST_RUNNERS);
  });
});
