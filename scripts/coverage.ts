#!/usr/bin/env bun
//
// Runs the unit suites with coverage and enforces the per-package baseline.
//
// Bun only reports coverage for files a test actually loads, so this is a
// floor on the code the suites touch rather than a measure of every source
// file. The thresholds are the baseline measured when the check was added,
// floored to a whole percent; raise them as coverage improves. See
// `docs/specs/test-coverage.md`.
//
// Usage: `bun run test:coverage`. CI runs the same command, writes the table
// to the job summary and uploads `coverage/lcov.info` to Codecov.

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export interface CoverageRecord {
  file: string;
  linesFound: number;
  linesHit: number;
  functionsFound: number;
  functionsHit: number;
}

export interface CoverageSummary {
  linesFound: number;
  linesHit: number;
  functionsFound: number;
  functionsHit: number;
}

export interface CoverageThreshold {
  lines: number;
  functions: number;
}

export interface ThresholdMiss {
  metric: "lines" | "functions";
  actual: number;
  minimum: number;
}

export interface CoverageGroup {
  /** Suite name used in the report and the raw coverage directory. */
  name: string;
  /** Repository-relative package directory; it owns the covered files and is the working directory. */
  root: string;
  /** Arguments passed to `bun test` before the coverage flags. */
  testArgs: string[];
  /** Minimum line and function coverage as fractions. */
  threshold: CoverageThreshold;
}

export interface CoverageSource {
  text: string;
  root: string;
}

export interface CoverageReportRow {
  name: string;
  summary: CoverageSummary;
  threshold: CoverageThreshold;
  misses: ThresholdMiss[];
}

/**
 * Paths left out of the coverage denominator. Prompt text is prose whose tests
 * assert contracts rather than lines, and drizzle-kit generates the migrations.
 */
export const COVERAGE_EXCLUDES = [
  "apps/api/src/llm/promptRules.ts",
  "apps/api/drizzle/",
] as const;

/**
 * The baseline measured on 2026-11-11, floored to a whole percent. Raise a
 * threshold when coverage improves; never lower one without a good reason.
 */
export const COVERAGE_GROUPS: readonly CoverageGroup[] = [
  {
    name: "api",
    root: "apps/api",
    testArgs: ["src"],
    threshold: { lines: 0.74, functions: 0.8 },
  },
  {
    name: "web",
    root: "apps/web",
    testArgs: ["src", "pwa", "notices"],
    threshold: { lines: 0.77, functions: 0.72 },
  },
  {
    name: "shared",
    root: "packages/shared",
    testArgs: [],
    threshold: { lines: 0.96, functions: 0.87 },
  },
];

/** Reads the line and function totals from an LCOV report. */
export function parseLcov(text: string): CoverageRecord[] {
  const records: CoverageRecord[] = [];
  for (const block of text.split("end_of_record")) {
    const file = block.match(/^SF:(.+)$/m)?.[1]?.trim();
    if (!file) continue;
    records.push({
      file,
      linesFound: numberField(block, "LF"),
      linesHit: numberField(block, "LH"),
      functionsFound: numberField(block, "FNF"),
      functionsHit: numberField(block, "FNH"),
    });
  }
  return records;
}

/** Normalises an LCOV source path relative to the repository root. */
export function toRepoPath(
  root: string,
  file: string,
  repoRoot: string,
): string {
  const absolute = path.isAbsolute(file)
    ? file
    : path.resolve(repoRoot, root, file);
  return path.relative(repoRoot, absolute).split(path.sep).join("/");
}

/** Whether a repository-relative path is outside the coverage denominator. */
export function isExcluded(
  file: string,
  excludes: readonly string[] = COVERAGE_EXCLUDES,
): boolean {
  return excludes.some((pattern) =>
    pattern.endsWith("/") ? file.startsWith(pattern) : file === pattern,
  );
}

/**
 * Normalises the paths in one suite's report and keeps only the files that
 * suite owns, so a package's shared imports are counted once.
 */
export function selectOwnedRecords(
  records: readonly CoverageRecord[],
  groupRoot: string,
  repoRoot: string,
  excludes: readonly string[] = COVERAGE_EXCLUDES,
): CoverageRecord[] {
  const selected = new Map<string, CoverageRecord>();
  for (const record of records) {
    const file = ownedFile(groupRoot, record.file, repoRoot, excludes);
    if (file) selected.set(file, { ...record, file });
  }
  return [...selected.values()];
}

export function summarize(records: readonly CoverageRecord[]): CoverageSummary {
  const summary: CoverageSummary = {
    linesFound: 0,
    linesHit: 0,
    functionsFound: 0,
    functionsHit: 0,
  };
  for (const record of records) {
    summary.linesFound += record.linesFound;
    summary.linesHit += record.linesHit;
    summary.functionsFound += record.functionsFound;
    summary.functionsHit += record.functionsHit;
  }
  return summary;
}

export function thresholdMisses(
  summary: CoverageSummary,
  threshold: CoverageThreshold,
): ThresholdMiss[] {
  const misses: ThresholdMiss[] = [];
  const lines = ratio(summary.linesHit, summary.linesFound);
  if (lines < threshold.lines) {
    misses.push({ metric: "lines", actual: lines, minimum: threshold.lines });
  }
  const functions = ratio(summary.functionsHit, summary.functionsFound);
  if (functions < threshold.functions) {
    misses.push({
      metric: "functions",
      actual: functions,
      minimum: threshold.functions,
    });
  }
  return misses;
}

/** Renders the coverage table shown in CI and the job summary. */
export function formatCoverageReport(
  rows: readonly CoverageReportRow[],
): string {
  const totals = rows.reduce<CoverageSummary>(
    (total, row) => ({
      linesFound: total.linesFound + row.summary.linesFound,
      linesHit: total.linesHit + row.summary.linesHit,
      functionsFound: total.functionsFound + row.summary.functionsFound,
      functionsHit: total.functionsHit + row.summary.functionsHit,
    }),
    { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 },
  );
  const allPassed = rows.every((row) => row.misses.length === 0);
  return [
    "| Suite | Lines | Functions | Threshold | Result |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.name} | ${coverageCell(row.summary.linesHit, row.summary.linesFound)} | ${coverageCell(row.summary.functionsHit, row.summary.functionsFound)} | ${thresholdCell(row.threshold)} | ${row.misses.length === 0 ? "pass" : "fail"} |`,
    ),
    `| **Total** | ${coverageCell(totals.linesHit, totals.linesFound)} | ${coverageCell(totals.functionsHit, totals.functionsFound)} | — | ${allPassed ? "pass" : "fail"} |`,
  ].join("\n");
}

/** Rewrites each suite's LCOV paths and concatenates them for Codecov. */
export function mergeLcov(
  sources: readonly CoverageSource[],
  repoRoot: string,
  excludes: readonly string[] = COVERAGE_EXCLUDES,
): string {
  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const source of sources) {
    for (const block of parseLcovBlocks(source.text)) {
      const sourceFile = block.match(/^SF:(.+)$/m)?.[1]?.trim();
      if (!sourceFile) continue;
      const file = ownedFile(source.root, sourceFile, repoRoot, excludes);
      if (!file || seen.has(file)) continue;
      seen.add(file);
      blocks.push(block.replace(/^SF:.+$/m, `SF:${file}`));
    }
  }
  return blocks.join("");
}

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const COVERAGE_DIR = path.join(REPO_ROOT, "coverage");
const RAW_COVERAGE_DIR = path.join(COVERAGE_DIR, "raw");

if (import.meta.main) {
  main();
}

function main(): void {
  rmSync(COVERAGE_DIR, { recursive: true, force: true });
  mkdirSync(RAW_COVERAGE_DIR, { recursive: true });

  // The root scripts suite covers development tooling, not application code.
  // It runs for parity with `bun run test` but is not part of the denominator.
  runTests("scripts", REPO_ROOT, ["scripts"]);

  const sources: CoverageSource[] = [];
  const rows: CoverageReportRow[] = [];
  for (const group of COVERAGE_GROUPS) {
    const coverageDir = path.join(RAW_COVERAGE_DIR, group.name);
    runTests(group.name, path.join(REPO_ROOT, group.root), [
      ...group.testArgs,
      "--coverage",
      "--coverage-reporter=lcov",
      "--coverage-dir",
      coverageDir,
    ]);

    const text = readFileSync(path.join(coverageDir, "lcov.info"), "utf8");
    const records = selectOwnedRecords(parseLcov(text), group.root, REPO_ROOT);
    if (records.length === 0) {
      console.error(`No coverage records for ${group.name} in ${group.root}.`);
      process.exit(1);
    }
    const summary = summarize(records);
    rows.push({
      name: group.name,
      summary,
      threshold: group.threshold,
      misses: thresholdMisses(summary, group.threshold),
    });
    sources.push({ text, root: group.root });
  }

  writeFileSync(
    path.join(COVERAGE_DIR, "lcov.info"),
    mergeLcov(sources, REPO_ROOT),
  );

  const report = formatCoverageReport(rows);
  console.log(`\n${report}\n`);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, `## Code coverage\n\n${report}\n`);
  }

  const failures = rows.filter((row) => row.misses.length > 0);
  if (failures.length === 0) return;

  console.error("Coverage is below the configured baseline:");
  for (const row of failures) {
    for (const miss of row.misses) {
      console.error(
        `  ${row.name} ${miss.metric}: ${formatPercent(miss.actual)} < ${formatPercent(miss.minimum)}`,
      );
    }
  }
  console.error(
    "Raise coverage, or change the baseline in scripts/coverage.ts with a documented reason; see docs/specs/test-coverage.md.",
  );
  process.exit(1);
}

function runTests(name: string, cwd: string, args: string[]): void {
  console.log(`\n> ${name}: bun test ${args.join(" ")}`);
  const result = Bun.spawnSync(["bun", "test", ...args], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    console.error(`\n${name} tests failed.`);
    process.exit(result.exitCode ?? 1);
  }
}

function ownedFile(
  root: string,
  file: string,
  repoRoot: string,
  excludes: readonly string[],
): string | null {
  const normalized = toRepoPath(root, file, repoRoot);
  if (!normalized.startsWith(`${root}/`) || isExcluded(normalized, excludes)) {
    return null;
  }
  return normalized;
}

function parseLcovBlocks(text: string): string[] {
  return text
    .split("end_of_record")
    .map((block) => block.trim())
    .filter((block) => /^SF:/m.test(block))
    .map((block) => `${block}\nend_of_record\n`);
}

function numberField(block: string, key: string): number {
  const match = block.match(new RegExp(`^${key}:(\\d+)$`, "m"));
  return match?.[1] ? Number(match[1]) : 0;
}

function ratio(hit: number, found: number): number {
  return found === 0 ? 1 : hit / found;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function coverageCell(hit: number, found: number): string {
  return `${formatPercent(ratio(hit, found))} (${hit}/${found})`;
}

function thresholdCell(threshold: CoverageThreshold): string {
  return `${(threshold.lines * 100).toFixed(1)}% / ${(threshold.functions * 100).toFixed(1)}%`;
}
