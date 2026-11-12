import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBenchmarkArgs } from "./config.js";

describe("parseBenchmarkArgs", () => {
  it("keeps the model order so the first model is the benchmark", async () => {
    const config = await parseBenchmarkArgs([
      "google/gemini-4-argon",
      "anthropic/claude-opus-5.5",
      "--today",
      "2026-10-26",
      "--run-id",
      "run-1",
    ]);

    expect(config.models).toEqual([
      "google/gemini-4-argon",
      "anthropic/claude-opus-5.5",
    ]);
    expect(config.today).toBe("2026-10-26");
    expect(config.refreshToday).toBe("2026-11-02");
    expect(config.runId).toBe("run-1");
    expect(config.help).toBe(false);
  });

  it("removes duplicate models without reordering", async () => {
    const config = await parseBenchmarkArgs([
      "google/gemini-4-argon",
      "anthropic/claude-opus-5.5",
      "google/gemini-4-argon",
      "--today",
      "2026-10-26",
    ]);

    expect(config.models).toEqual([
      "google/gemini-4-argon",
      "anthropic/claude-opus-5.5",
    ]);
  });

  it("reads a models file and ignores comments and blanks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "benchmark-config-"));
    const path = join(directory, "models.txt");
    await writeFile(
      path,
      "# benchmark first\n\ngoogle/gemini-4-argon\n\nanthropic/claude-opus-5.5\n",
    );

    const config = await parseBenchmarkArgs([
      "--models-file",
      path,
      "--today",
      "2026-10-26",
    ]);

    expect(config.models).toEqual([
      "google/gemini-4-argon",
      "anthropic/claude-opus-5.5",
    ]);
  });

  it("allows report-only mode without models", async () => {
    const config = await parseBenchmarkArgs([
      "--report-only",
      "/tmp/a-run",
      "--today",
      "2026-10-26",
    ]);

    expect(config.reportOnlyDir).toBe("/tmp/a-run");
    expect(config.models).toEqual([]);
  });

  it("rejects mixed positional models and a model file", async () => {
    let failure: unknown;
    try {
      await parseBenchmarkArgs([
        "--models-file",
        "/tmp/models.txt",
        "moonshotai/kimi-k3.1-pro",
        "--today",
        "2026-10-26",
      ]);
    } catch (err) {
      failure = err;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      "either --models-file or positional models",
    );
  });

  it("rejects a refresh day that is not after the full build", async () => {
    let failure: unknown;
    try {
      await parseBenchmarkArgs([
        "google/gemini-4-argon",
        "--today",
        "2026-10-26",
        "--refresh-today",
        "2026-10-26",
      ]);
    } catch (err) {
      failure = err;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      "--refresh-today must be after --today",
    );
  });

  it("rejects an invalid date", async () => {
    let failure: unknown;
    try {
      await parseBenchmarkArgs([
        "google/gemini-4-argon",
        "--today",
        "26-10-2026",
      ]);
    } catch (err) {
      failure = err;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      "--today must be a valid YYYY-MM-DD date",
    );
  });
});
