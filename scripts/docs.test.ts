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

/** The source trees whose files the documents may name by path. */
const SOURCE_ROOTS = /^(?:apps|packages|scripts|services|tools)\//;

/**
 * A path segment the checkout generates or keeps out of version control: a
 * virtualenv (`.venv`), a local env file (`.env.local`) or build output
 * (`dist`). Such a path names no file in a fresh clone.
 */
const GENERATED_SEGMENT = /^(?:\.|build$|coverage$|dist$|node_modules$)/;

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

/**
 * Backticked source paths. A command snippet such as
 * `scripts/agent.sh logs api`, a glob over `apps/web/**`, a placeholder such as
 * `apps/web/src/use<Name>.ts` and generated output such as `services/garmin/.venv`
 * name no file a checkout carries, so the same rules the document guard uses
 * skip them here.
 */
function sourcePaths(text: string): string[] {
  return [...text.matchAll(/`([^`\n]+)`/g)].flatMap((match) => {
    const candidate = match[1];
    if (
      candidate === undefined ||
      !SOURCE_ROOTS.test(candidate) ||
      /\s/.test(candidate) ||
      !namesFile(candidate) ||
      candidate.split("/").some((segment) => GENERATED_SEGMENT.test(segment))
    ) {
      return [];
    }
    return [candidate];
  });
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

/** The documents whose backticked paths point into the source tree. */
const SOURCE_REFERENCE_TEXTS = await Promise.all(
  ["AGENTS.md", "README.md", ...SPEC_FILES, ...ADR_FILES].map((file) =>
    Bun.file(path.join(ROOT, file)).text(),
  ),
);

const SOURCE_PATHS = [
  ...new Set(SOURCE_REFERENCE_TEXTS.flatMap(sourcePaths)),
].sort();

/**
 * Source paths the documents cite on purpose although no such file exists:
 * ADR 0032 records that the benchmark script moved out of the API runtime, so
 * its old path is history rather than a broken reference. The guard asserts
 * each entry stays referenced and absent, so an allowlisted entry cannot hide
 * a real break.
 */
const HISTORICAL_SOURCE_PATHS = new Set([
  "apps/api/src/llm/promptBenchmark.ts",
]);

const MISSING_SOURCE_PATHS = SOURCE_PATHS.filter(
  (sourcePath) =>
    !HISTORICAL_SOURCE_PATHS.has(sourcePath) &&
    !existsSync(path.join(ROOT, sourcePath)),
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

describe("source paths", () => {
  it("finds the source paths the documents name", () => {
    expect(SOURCE_PATHS.length).toBeGreaterThan(50);
    // One path from each source root, so a narrowed pattern cannot pass by
    // matching nothing.
    expect(SOURCE_PATHS).toContain(
      "apps/web/src/activities/useActivityFeed.ts",
    );
    expect(SOURCE_PATHS).toContain("packages/shared/src/trainingLoad.ts");
    expect(SOURCE_PATHS).toContain("scripts/agent.sh");
    expect(SOURCE_PATHS).toContain("services/garmin/app.py");
    expect(SOURCE_PATHS).toContain("tools/benchmark/src/cli.ts");
  });

  it("keeps every referenced source path on disk", () => {
    // A renamed module leaves the docs pointing at a file nobody can open.
    expect(MISSING_SOURCE_PATHS).toEqual([]);
  });

  it("keeps each historical source path referenced and absent", () => {
    for (const historicalPath of HISTORICAL_SOURCE_PATHS) {
      expect(SOURCE_PATHS).toContain(historicalPath);
      expect(existsSync(path.join(ROOT, historicalPath))).toBe(false);
    }
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
