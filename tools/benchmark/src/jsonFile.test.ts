import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import {
  readJsonEntries,
  readJsonFile,
  readJsonFileOr,
  writeJsonFile,
} from "./jsonFile.js";
import {
  promptBenchmarkSourcesSchema,
  promptJudgeOverridesSchema,
  promptJudgeScoreSchema,
  promptModelResultSchema,
  type PromptAttempt,
  type PromptModelResult,
  type PromptRunResult,
} from "./promptBenchmarkTypes.js";

const ATTEMPT: PromptAttempt = {
  startedAt: "2026-11-01T13:54:19.481Z",
  timeMs: 1000,
  httpStatus: 200,
  finishReason: "stop",
  usage: {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    cost: 0.01,
  },
  costUsd: 0.01,
  raw: '{"today":{"date":"2026-10-30"}}',
  parsed: { today: { date: "2026-10-30" } },
  parseError: null,
  error: null,
};

const REVISION_RESULT: PromptRunResult = {
  prompt: "reviseSeason",
  attempts: [ATTEMPT],
  retryNeeded: false,
  ok: true,
  totalTimeMs: 1000,
  totalCostUsd: 0.01,
  plan: { season: { goal: "Atlas" } },
  validationErrors: [],
};

const GOAL_RESULT: PromptRunResult = {
  ...REVISION_RESULT,
  prompt: "goalSteering",
  plan: { block: { name: "Gravel build" } },
};

const MODEL_RESULT: PromptModelResult = {
  id: "example/model",
  name: "Example",
  requestedAt: "2026-11-01T13:54:19.481Z",
  prompts: { reviseSeason: REVISION_RESULT, goalSteering: GOAL_RESULT },
  ok: true,
  totalTimeMs: 2000,
  totalCostUsd: 0.02,
};

const GATES = {
  atlasMentioned: true,
  blockOneChanged: true,
  blockOneStartDateKept: true,
  atlasQuestionAsked: false,
  failures: [],
};

const JUDGE = {
  score: 10.5,
  components: { contract: 1.5, fidelity: 2, design: 2.5 },
  note: "Good.",
  judge: {
    model: "anthropic/claude-haiku-5.5",
    attempts: 1,
    timeMs: 500,
    costUsd: 0.001,
    error: null,
  },
};

const JUDGE_SCORE = {
  ...JUDGE,
  id: "example/model",
  failed: false,
  gates: GATES,
  prompts: { reviseSeason: JUDGE, goalSteering: JUDGE },
};

/** A run file schema and one valid value for it. */
interface FileFixture {
  name: string;
  schema: z.ZodType<unknown>;
  fixture: unknown;
}

/**
 * A run file schema and one valid value for it. The model result nests the
 * usage, attempt, gates and judge shapes, so it covers every stored file the
 * stages read.
 */
const FILE_FIXTURES: readonly FileFixture[] = [
  {
    name: "model result",
    schema: promptModelResultSchema,
    fixture: MODEL_RESULT,
  },
  { name: "judge score", schema: promptJudgeScoreSchema, fixture: JUDGE_SCORE },
  {
    name: "judge overrides",
    schema: promptJudgeOverridesSchema,
    fixture: { "example/model": { score: 9.5, note: "Fairer." } },
  },
  {
    name: "sources",
    schema: promptBenchmarkSourcesSchema,
    fixture: { runIds: ["2026-11-01-cost-a-plus-v2"] },
  },
];

/** A fresh directory for one test. */
async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "benchmark-json-file-"));
}

/** Writes one value as JSON and returns its path. */
async function writeFixture(
  value: unknown,
  name = "results.json",
): Promise<string> {
  const path = join(await temporaryDirectory(), name);
  await writeJsonFile(path, value);
  return path;
}

describe("readJsonFile", () => {
  for (const fixture of FILE_FIXTURES) {
    it(`parses a valid ${fixture.name} file`, async () => {
      const path = await writeFixture(fixture.fixture);
      expect(await readJsonFile(path, fixture.schema)).toEqual(fixture.fixture);
    });
  }

  it("names the file and the field when a required field is missing", async () => {
    const broken: Record<string, unknown> = { ...MODEL_RESULT };
    delete broken.id;
    const path = await writeFixture([broken]);
    let failure: unknown;
    try {
      await readJsonFile(path, promptModelResultSchema.array());
    } catch (err) {
      failure = err;
    }
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain(path);
    expect(message).toContain("0.id");
    expect(message).toContain("expected string, received undefined");
  });

  it("names the file and the field when a field has the wrong type", async () => {
    const broken: Record<string, unknown> = {
      ...MODEL_RESULT,
      totalTimeMs: "slow",
    };
    const path = await writeFixture(broken);
    let failure: unknown;
    try {
      await readJsonFile(path, promptModelResultSchema);
    } catch (err) {
      failure = err;
    }
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain(path);
    expect(message).toContain("totalTimeMs");
  });

  it("accepts a run written before the goal-steering prompt existed", async () => {
    const older: Record<string, unknown> = {
      ...MODEL_RESULT,
      prompts: { reviseSeason: REVISION_RESULT },
    };
    const path = await writeFixture(older);
    const parsed = await readJsonFile(path, promptModelResultSchema);
    expect(Object.keys(parsed.prompts)).toEqual(["reviseSeason"]);
  });

  it("names the file when the JSON itself is invalid", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "results.json");
    await writeFile(path, "{not json");
    return expect(readJsonFile(path, promptModelResultSchema)).rejects.toThrow(
      `${path} is not valid JSON`,
    );
  });
});

describe("readJsonFileOr", () => {
  it("returns the fallback for an absent file", async () => {
    const path = join(await temporaryDirectory(), "missing.json");
    expect(
      await readJsonFileOr(path, promptBenchmarkSourcesSchema, {}),
    ).toEqual({});
  });

  it("returns the fallback for an invalid file", async () => {
    const path = await writeFixture({ runIds: "not a list" });
    expect(
      await readJsonFileOr(path, promptBenchmarkSourcesSchema, {
        runIds: ["fallback"],
      }),
    ).toEqual({ runIds: ["fallback"] });
  });
});

describe("readJsonEntries", () => {
  it("keeps partial entries and drops the old flat shape", async () => {
    const oldFormat = {
      id: "old/model",
      name: "Old",
      requestedAt: "2026-10-30T00:00:00.000Z",
      attempts: [ATTEMPT],
      plan: null,
      ok: true,
      retryNeeded: false,
      totalTimeMs: 1000,
      totalCostUsd: 0.01,
      validationErrors: [],
    };
    const partial: Record<string, unknown> = {
      ...MODEL_RESULT,
      id: "partial/model",
      prompts: { reviseSeason: REVISION_RESULT },
    };
    const path = await writeFixture([MODEL_RESULT, oldFormat, partial]);
    const entries = await readJsonEntries(path, promptModelResultSchema);
    expect(entries.map((entry) => entry.id)).toEqual([
      "example/model",
      "partial/model",
    ]);
  });

  it("returns no entries when the file is absent", async () => {
    const path = join(await temporaryDirectory(), "missing.json");
    expect(await readJsonEntries(path, promptModelResultSchema)).toEqual([]);
  });
});

describe("stored files from an older run", () => {
  it("keeps OpenRouter's extra usage fields through a re-save", async () => {
    const attempt = {
      ...ATTEMPT,
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cost: 0.01,
        is_byok: false,
        cost_details: { upstream_inference_cost: 0.01 },
      },
    };
    const path = await writeFixture({
      ...MODEL_RESULT,
      prompts: {
        reviseSeason: { ...REVISION_RESULT, attempts: [attempt] },
        goalSteering: GOAL_RESULT,
      },
    });
    const parsed = await readJsonFile(path, promptModelResultSchema);
    expect(parsed.prompts.reviseSeason?.attempts[0]?.usage).toEqual(
      attempt.usage,
    );
  });

  it("accepts a judge score written before the Atlas-question gate", async () => {
    const gates = {
      atlasMentioned: true,
      blockOneChanged: true,
      blockOneStartDateKept: true,
      failures: [],
    };
    const path = await writeFixture({ ...JUDGE_SCORE, gates });
    const parsed = await readJsonFile(path, promptJudgeScoreSchema);
    expect(parsed.gates?.atlasQuestionAsked).toBeUndefined();
    expect(parsed.score).toBe(JUDGE.score);
  });
});
