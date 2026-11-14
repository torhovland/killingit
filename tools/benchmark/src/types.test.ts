import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readJsonFile, writeJsonFile } from "./jsonFile.js";
import {
  benchmarkResultsSchema,
  benchmarkScoresSchema,
  type BenchmarkResults,
} from "./types.js";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const COMMITTED_RUNS_ROOT = resolve(REPO_ROOT, "benchmarks/llm-coach/runs");

/** A complete results file without a plan, so the fixture needs no coach plan. */
function results(): BenchmarkResults {
  return {
    metadata: {
      runId: "run-1",
      runAt: "2026-10-26T00:00:00.000Z",
      gitCommit: "abc123",
      userId: 1,
      today: "2026-10-26",
      refreshToday: "2026-11-02",
      benchmarkModel: "google/gemini-4-argon",
      models: ["google/gemini-4-argon"],
      planMaxTokens: 16_384,
      exclusions: ["No weather."],
    },
    models: {
      "google/gemini-4-argon": {
        model: "google/gemini-4-argon",
        pricing: {
          promptPricePerMillion: 1.5,
          completionPricePerMillion: 6,
          contextLength: 1_000_000,
        },
        full: {
          ok: true,
          wallMs: 100_000,
          costUsd: 0.2,
          promptTokens: 100,
          completionTokens: 50,
          reasoningTokens: 10,
          calls: [
            {
              step: "season",
              repair: false,
              maxTokens: 16_384,
              reasoning: null,
              startedAt: "2026-10-26T00:00:00.000Z",
              durationMs: 100_000,
              httpStatus: 200,
              finishReason: "stop",
              contentChars: 100,
              usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                total_tokens: 150,
                cost: 0.2,
              },
              error: null,
            },
          ],
          plan: null,
          error: null,
        },
        refresh: null,
        error: null,
      },
    },
  };
}

/** A fresh directory for one test. */
async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "benchmark-types-"));
}

/** Writes one value as JSON and returns its path. */
async function writeFixture(value: unknown, name: string): Promise<string> {
  const path = join(await temporaryDirectory(), name);
  await writeJsonFile(path, value);
  return path;
}

/** The committed run files that exist on disk. */
function committedRunFiles(name: string): string[] {
  if (!existsSync(COMMITTED_RUNS_ROOT)) return [];
  return readdirSync(COMMITTED_RUNS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(COMMITTED_RUNS_ROOT, entry.name, name))
    .filter((path) => existsSync(path));
}

describe("plan-comparison result files", () => {
  it("reads a stored run and its scores", async () => {
    const path = await writeFixture(results(), "results.json");
    const parsed = await readJsonFile(path, benchmarkResultsSchema);
    expect(parsed).toEqual(results());

    const scoresPath = await writeFixture(
      { "google/gemini-4-argon": { quality: 9.5, notes: "Complete." } },
      "scores.json",
    );
    expect(await readJsonFile(scoresPath, benchmarkScoresSchema)).toEqual({
      "google/gemini-4-argon": { quality: 9.5, notes: "Complete." },
    });
  });

  it("names the file when a metadata field is missing", async () => {
    const valid = results();
    const metadata: Record<string, unknown> = { ...valid.metadata };
    delete metadata.userId;
    const path = await writeFixture({ ...valid, metadata }, "results.json");
    let failure: unknown;
    try {
      await readJsonFile(path, benchmarkResultsSchema);
    } catch (err) {
      failure = err;
    }
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain(path);
    expect(message).toContain("metadata.userId");
  });

  it("names the file when a run field has the wrong type", async () => {
    const broken = results();
    const model = broken.models["google/gemini-4-argon"];
    if (model?.full) {
      Object.assign(model.full, { promptTokens: "many" });
    }
    const path = await writeFixture(broken, "results.json");
    return expect(readJsonFile(path, benchmarkResultsSchema)).rejects.toThrow(
      `${path} does not match the expected file shape`,
    );
  });

  it("rejects a quality score outside the recorded range", async () => {
    const path = await writeFixture(
      { "example/model": { quality: 11, notes: "Too good." } },
      "scores.json",
    );
    return expect(readJsonFile(path, benchmarkScoresSchema)).rejects.toThrow(
      "quality",
    );
  });
});

/**
 * The committed runs are the comparison history. This catches a plan or file
 * shape change that would make `--report-only` fail on the recorded runs.
 */
describe("committed plan-comparison runs", () => {
  it("parses every committed results.json", async () => {
    const paths = committedRunFiles("results.json");
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const parsed = await readJsonFile(path, benchmarkResultsSchema);
      expect(parsed.metadata.models.length).toBeGreaterThan(0);
    }
  });

  it("parses every committed scores.json", async () => {
    const paths = committedRunFiles("scores.json");
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const parsed = await readJsonFile(path, benchmarkScoresSchema);
      expect(Object.keys(parsed).length).toBeGreaterThan(0);
    }
  });
});
