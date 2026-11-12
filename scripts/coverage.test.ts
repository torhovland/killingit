import { describe, expect, test } from "bun:test";

import {
  COVERAGE_EXCLUDES,
  COVERAGE_GROUPS,
  formatCoverageReport,
  isExcluded,
  mergeLcov,
  parseLcov,
  selectOwnedRecords,
  summarize,
  thresholdMisses,
  toRepoPath,
} from "./coverage";

const LCOV = `TN:
SF:src/llm/promptRules.ts
FNF:5
FNH:5
DA:15,54
LF:130
LH:130
end_of_record
TN:
SF:src/llm/coachPlan.ts
FNF:10
FNH:8
DA:1,1
DA:2,0
LF:20
LH:18
end_of_record
TN:
SF:../../packages/shared/src/date.ts
FNF:4
FNH:4
DA:1,1
LF:16
LH:16
end_of_record
`;

const REPO_ROOT = "/repo";

describe("parseLcov", () => {
  test("reads the line and function totals from every record", () => {
    expect(parseLcov(LCOV)).toEqual([
      {
        file: "src/llm/promptRules.ts",
        linesFound: 130,
        linesHit: 130,
        functionsFound: 5,
        functionsHit: 5,
      },
      {
        file: "src/llm/coachPlan.ts",
        linesFound: 20,
        linesHit: 18,
        functionsFound: 10,
        functionsHit: 8,
      },
      {
        file: "../../packages/shared/src/date.ts",
        linesFound: 16,
        linesHit: 16,
        functionsFound: 4,
        functionsHit: 4,
      },
    ]);
  });

  test("ignores text outside a record and records without a source path", () => {
    expect(parseLcov("noise\nTN:\nLF:1\nLH:1\nend_of_record\n")).toEqual([]);
  });
});

describe("toRepoPath", () => {
  test("resolves a package-relative path against the package root", () => {
    expect(toRepoPath("apps/api", "src/llm/coachPlan.ts", REPO_ROOT)).toBe(
      "apps/api/src/llm/coachPlan.ts",
    );
  });

  test("resolves a path that climbs into another workspace package", () => {
    expect(
      toRepoPath("apps/web", "../../packages/shared/src/date.ts", REPO_ROOT),
    ).toBe("packages/shared/src/date.ts");
  });
});

describe("isExcluded", () => {
  test("matches an exact file and a directory prefix", () => {
    expect(isExcluded("apps/api/src/llm/promptRules.ts")).toBe(true);
    expect(isExcluded("apps/api/drizzle/0000_closed_sentinels.sql")).toBe(true);
    expect(isExcluded("apps/api/src/llm/coachPlan.ts")).toBe(false);
  });

  test("does not treat the exclude list as a prefix for unrelated names", () => {
    expect(isExcluded("apps/api/src/llm/promptRulesExtra.ts")).toBe(false);
  });
});

describe("selectOwnedRecords", () => {
  test("normalises paths and drops files owned by another test suite", () => {
    const records = selectOwnedRecords(parseLcov(LCOV), "apps/api", REPO_ROOT);

    expect(records).toEqual([
      {
        file: "apps/api/src/llm/coachPlan.ts",
        linesFound: 20,
        linesHit: 18,
        functionsFound: 10,
        functionsHit: 8,
      },
    ]);
  });

  test("drops excluded prompt text", () => {
    const lcov = `TN:
SF:src/llm/promptRules.ts
FNF:1
FNH:1
LF:130
LH:130
end_of_record
TN:
SF:src/db/schema.ts
FNF:1
FNH:1
LF:10
LH:10
end_of_record
`;
    expect(
      selectOwnedRecords(parseLcov(lcov), "apps/api", REPO_ROOT),
    ).toHaveLength(1);
  });
});

describe("summarize", () => {
  test("adds the totals across records", () => {
    expect(
      summarize(selectOwnedRecords(parseLcov(LCOV), "apps/api", REPO_ROOT)),
    ).toEqual({
      linesFound: 20,
      linesHit: 18,
      functionsFound: 10,
      functionsHit: 8,
    });
  });
});

describe("thresholdMisses", () => {
  const summary = {
    linesFound: 200,
    linesHit: 180,
    functionsFound: 100,
    functionsHit: 70,
  };

  test("reports each metric that is below its threshold", () => {
    expect(thresholdMisses(summary, { lines: 0.95, functions: 0.8 })).toEqual([
      { metric: "lines", actual: 0.9, minimum: 0.95 },
      { metric: "functions", actual: 0.7, minimum: 0.8 },
    ]);
  });

  test("passes when both metrics meet their thresholds", () => {
    expect(thresholdMisses(summary, { lines: 0.9, functions: 0.7 })).toEqual(
      [],
    );
  });

  test("treats an empty suite as fully covered", () => {
    expect(
      thresholdMisses(
        { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 },
        { lines: 1, functions: 1 },
      ),
    ).toEqual([]);
  });
});

describe("formatCoverageReport", () => {
  test("renders a table with each suite, its totals and a total row", () => {
    const report = formatCoverageReport([
      {
        name: "api",
        summary: {
          linesFound: 20,
          linesHit: 18,
          functionsFound: 10,
          functionsHit: 8,
        },
        threshold: { lines: 0.9, functions: 0.8 },
        misses: [],
      },
      {
        name: "web",
        summary: {
          linesFound: 40,
          linesHit: 30,
          functionsFound: 20,
          functionsHit: 10,
        },
        threshold: { lines: 0.8, functions: 0.6 },
        misses: [{ metric: "lines", actual: 0.75, minimum: 0.8 }],
      },
    ]);

    expect(report).toContain("| Suite | Lines | Functions | Threshold |");
    expect(report).toContain("90.00% (18/20)");
    expect(report).toContain("80.00% (8/10)");
    expect(report).toContain("75.00% (30/40)");
    expect(report).toContain("60.00% (18/30)");
    expect(report).toContain("| **Total** | 80.00% (48/60) |");
    expect(report).toContain("| api |");
    expect(
      report.split("\n").find((line) => line.startsWith("| web |")),
    ).toContain("| fail |");
  });
});

describe("mergeLcov", () => {
  test("rewrites source paths to repository-relative paths", () => {
    const merged = mergeLcov([{ text: LCOV, root: "apps/api" }], REPO_ROOT);

    expect(merged).toContain("SF:apps/api/src/llm/coachPlan.ts");
    expect(merged).not.toContain("SF:src/llm/coachPlan.ts");
  });

  test("drops files from another package and excluded paths", () => {
    const merged = mergeLcov([{ text: LCOV, root: "apps/api" }], REPO_ROOT);

    expect(merged).not.toContain("packages/shared");
    expect(merged).not.toContain("promptRules.ts");
  });

  test("keeps only one record for a file seen twice", () => {
    const merged = mergeLcov(
      [
        { text: LCOV, root: "apps/api" },
        { text: LCOV, root: "apps/api" },
      ],
      REPO_ROOT,
    );

    expect(merged.match(/SF:apps\/api\/src\/llm\/coachPlan.ts/g)).toHaveLength(
      1,
    );
  });
});

describe("coverage configuration", () => {
  test("documents a valid baseline for every suite", () => {
    for (const group of COVERAGE_GROUPS) {
      expect(group.root).toMatch(/^(apps|packages|tools)\//);
      expect(group.threshold.lines).toBeGreaterThanOrEqual(0);
      expect(group.threshold.lines).toBeLessThanOrEqual(1);
      expect(group.threshold.functions).toBeGreaterThanOrEqual(0);
      expect(group.threshold.functions).toBeLessThanOrEqual(1);
    }
  });

  test("gives each suite a unique name and root", () => {
    const names = COVERAGE_GROUPS.map((group) => group.name);
    const roots = COVERAGE_GROUPS.map((group) => group.root);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(roots).size).toBe(roots.length);
  });

  test("excludes prompt text and generated migrations", () => {
    expect(COVERAGE_EXCLUDES).toContain("apps/api/src/llm/promptRules.ts");
    expect(COVERAGE_EXCLUDES).toContain("apps/api/drizzle/");
  });
});
