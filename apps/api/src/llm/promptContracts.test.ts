/**
 * Parity between the model-facing JSON contracts in `promptRules.ts` and the
 * Zod schemas in `@killingit/shared` that parse the coach's answer.
 *
 * Every contract restates a schema's field list by hand, so a field added on one
 * side alone is invisible to the other: the coach never returns a field the
 * schema accepts, or returns a field the schema cannot hold and the completion
 * fails or repairs at runtime. These tests parse both sides into the same key
 * tree and compare them, failing with the contract, the path and the key.
 *
 * The mapping between a contract and its schema:
 *
 * - `DAY_CONTRACT` → `dayPlanSchema`
 * - `WEEK_CONTRACT` → `weekPlanSchema`, its `sessions` → `weekSessionSchema`
 * - `BLOCK_CONTRACT` → `blockPlanSchema`, its `weeks` → `blockWeekSummarySchema`
 * - `SEASON_CONTRACT` → `seasonPlanSchema`, its `blocks` →
 *   `seasonBlockSummarySchema`
 * - `DIET_CONTRACT` → `dietPlanSchema`
 * - `COACH_RESPONSE_NOTES_CONTRACT` → `coachResponseNotesSchema`
 * - `BODY_METRIC_POINT_CONTRACT` → `bodyMetricEstimateSchema`
 * - `COACH_ANALYSIS_CONTRACT` → `coachAnalysisResultSchema`
 * - `COACH_REPLY_CONTRACT` → `coachReplyResultSchema`
 *
 * The nested fragments `BIKE_WORKOUT_CONTRACT`, `CALORIE_BREAKDOWN_CONTRACT` and
 * `DIET_PROGRESS_CONTRACT` are compared inside the contracts that embed them.
 *
 * A schema may hold keys the contract never asks for when the API derives them
 * after the coach responds; `serverKeys` lists those, so they must not appear in
 * a contract. Any other difference fails the test.
 */

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  blockPlanSchema,
  bodyMetricEstimateSchema,
  coachAnalysisResultSchema,
  coachReplyResultSchema,
  coachResponseNotesSchema,
  dayPlanSchema,
  dietPlanSchema,
  seasonPlanSchema,
  weekPlanSchema,
} from "@killingit/shared";
import {
  BLOCK_CONTRACT,
  BODY_METRIC_POINT_CONTRACT,
  COACH_ANALYSIS_CONTRACT,
  COACH_REPLY_CONTRACT,
  COACH_RESPONSE_NOTES_CONTRACT,
  DAY_CONTRACT,
  DIET_CONTRACT,
  SEASON_CONTRACT,
  WEEK_CONTRACT,
} from "./promptRules.js";

/**
 * One object level of a contract or schema: each key and the nested object it
 * holds, or null for a value and for a list of values.
 */
type KeyShape = ReadonlyMap<string, KeyShape | null>;

interface Cursor {
  readonly text: string;
  index: number;
}

/** One prompt contract and the schema that parses the model's answer to it. */
interface ContractMapping {
  /** The exported contract constant, named as it appears in `promptRules.ts`. */
  contractName: string;
  contract: string;
  /** The Zod schema constant, named as it appears in the shared package. */
  schemaName: string;
  schema: KeyShape;
  /**
   * Keys the API derives after the coach responds, by contract path. The root
   * is `""` and a nested object is its key chain, such as `"sessions"`.
   */
  serverKeys?: Readonly<Record<string, readonly string[]>>;
}

const CONTRACT_MAPPINGS: readonly ContractMapping[] = [
  {
    contractName: "DAY_CONTRACT",
    contract: DAY_CONTRACT,
    schemaName: "dayPlanSchema",
    schema: schemaKeys(dayPlanSchema),
    // The forecast for the day and its training-load snapshot are attached by
    // the API once the plan is saved.
    serverKeys: { "": ["forecasts", "weather", "trainingLoad"] },
  },
  {
    contractName: "WEEK_CONTRACT",
    contract: WEEK_CONTRACT,
    schemaName: "weekPlanSchema",
    schema: schemaKeys(weekPlanSchema),
    // The same day-level attach applies to each session in the week.
    serverKeys: { sessions: ["forecasts", "weather", "trainingLoad"] },
  },
  {
    contractName: "BLOCK_CONTRACT",
    contract: BLOCK_CONTRACT,
    schemaName: "blockPlanSchema",
    schema: schemaKeys(blockPlanSchema),
    // The block view shows the current week's estimate rather than asking the
    // coach for a separate one.
    serverKeys: { "": ["estimatedFtpWatts"] },
  },
  {
    contractName: "SEASON_CONTRACT",
    contract: SEASON_CONTRACT,
    schemaName: "seasonPlanSchema",
    schema: schemaKeys(seasonPlanSchema),
    // The season view shows the current week's estimate, like the block.
    serverKeys: { "": ["estimatedFtpWatts"] },
  },
  {
    contractName: "DIET_CONTRACT",
    contract: DIET_CONTRACT,
    schemaName: "dietPlanSchema",
    schema: schemaKeys(dietPlanSchema),
  },
  {
    contractName: "COACH_RESPONSE_NOTES_CONTRACT",
    contract: COACH_RESPONSE_NOTES_CONTRACT,
    schemaName: "coachResponseNotesSchema",
    schema: schemaKeys(coachResponseNotesSchema),
  },
  {
    contractName: "BODY_METRIC_POINT_CONTRACT",
    contract: BODY_METRIC_POINT_CONTRACT,
    schemaName: "bodyMetricEstimateSchema",
    schema: schemaKeys(bodyMetricEstimateSchema),
  },
  {
    contractName: "COACH_ANALYSIS_CONTRACT",
    contract: COACH_ANALYSIS_CONTRACT,
    schemaName: "coachAnalysisResultSchema",
    schema: schemaKeys(coachAnalysisResultSchema),
  },
  {
    contractName: "COACH_REPLY_CONTRACT",
    contract: COACH_REPLY_CONTRACT,
    schemaName: "coachReplyResultSchema",
    schema: schemaKeys(coachReplyResultSchema),
  },
];

/**
 * The keys of a Zod schema's input shape, from its JSON Schema form, so
 * nullability, optionality, defaults and the optional-rationale preprocess do
 * not hide a field.
 */
function schemaKeys(schema: z.ZodType): KeyShape {
  return objectKeysFromJsonSchema(z.toJSONSchema(schema, { io: "input" }));
}

/**
 * The keys and nested objects of a contract string. A fragment may be a bare
 * list of members rather than a whole object, so it is wrapped to parse alike.
 */
function parseContractKeys(contract: string): KeyShape {
  const text = contract.trimStart().startsWith("{")
    ? contract
    : `{${contract}}`;
  return readObjectKeys({ text, index: 0 });
}

/**
 * The differences between a contract and its schema, as readable lines. An
 * empty list means the two sides agree at every level.
 */
function contractMismatches(mapping: ContractMapping): string[] {
  const problems: string[] = [];
  compareKeyShapes(
    parseContractKeys(mapping.contract),
    mapping.schema,
    mapping,
    "",
    problems,
  );
  return problems;
}

function compareKeyShapes(
  contract: KeyShape,
  schema: KeyShape,
  mapping: ContractMapping,
  path: string,
  problems: string[],
): void {
  const allowed = new Set(mapping.serverKeys?.[path] ?? []);
  const at =
    path === "" ? mapping.contractName : `${mapping.contractName}["${path}"]`;

  for (const key of schema.keys()) {
    if (allowed.has(key) || contract.has(key)) {
      continue;
    }
    problems.push(
      `${at}: the contract is missing "${key}", which ${mapping.schemaName} accepts`,
    );
  }

  for (const [key, contractChild] of contract) {
    const schemaChild = schema.get(key);
    if (schemaChild === undefined) {
      problems.push(
        `${at}: the contract has "${key}", which ${mapping.schemaName} does not accept`,
      );
      continue;
    }
    if (contractChild === null && schemaChild === null) {
      continue;
    }
    if (contractChild === null || schemaChild === null) {
      const contractKind = contractChild === null ? "a value" : "an object";
      const schemaKind = schemaChild === null ? "a value" : "an object";
      problems.push(
        `${at}: "${key}" is ${contractKind} in the contract and ${schemaKind} in ${mapping.schemaName}`,
      );
      continue;
    }
    const childPath = path === "" ? key : `${path}.${key}`;
    compareKeyShapes(contractChild, schemaChild, mapping, childPath, problems);
  }
}

/** Reads one `{ ... }` object level of a contract. */
function readObjectKeys(cursor: Cursor): KeyShape {
  const keys = new Map<string, KeyShape | null>();
  expectChar(cursor, "{");
  for (;;) {
    skipWhitespace(cursor);
    const char = peek(cursor);
    if (char === "}") {
      cursor.index += 1;
      return keys;
    }
    if (char === ",") {
      cursor.index += 1;
      continue;
    }
    const key = readQuoted(cursor);
    skipWhitespace(cursor);
    expectChar(cursor, ":");
    keys.set(key, readValueKeys(cursor));
  }
}

/**
 * Reads the value of one key. Objects and the first object of a list carry
 * their keys; every other value is null. A union suffix such as ` | null` after
 * an object is skipped.
 */
function readValueKeys(cursor: Cursor): KeyShape | null {
  skipWhitespace(cursor);
  let keys: KeyShape | null = null;
  if (peek(cursor) === "{") {
    keys = readObjectKeys(cursor);
  } else if (peek(cursor) === "[") {
    cursor.index += 1;
    skipWhitespace(cursor);
    if (peek(cursor) === "{") {
      keys = readObjectKeys(cursor);
      skipWhitespace(cursor);
      expectChar(cursor, "]");
    } else {
      // A list of values carries no keys, so only its brackets matter.
      skipToDelimiter(cursor);
      expectChar(cursor, "]");
    }
  }
  skipToDelimiter(cursor);
  return keys;
}

/** The keys of one JSON Schema object, and of the object a field holds. */
function objectKeysFromJsonSchema(node: unknown): KeyShape {
  const keys = new Map<string, KeyShape | null>();
  for (const [key, value] of Object.entries(jsonSchemaProperties(node))) {
    keys.set(key, nestedKeysFromJsonSchema(value));
  }
  return keys;
}

/** The object keys a JSON Schema field holds, through a list or a union. */
function nestedKeysFromJsonSchema(node: unknown): KeyShape | null {
  if (!isRecord(node)) {
    return null;
  }
  if (Array.isArray(node["anyOf"])) {
    for (const branch of node["anyOf"]) {
      const keys = nestedKeysFromJsonSchema(branch);
      if (keys !== null) {
        return keys;
      }
    }
    return null;
  }
  if (node["type"] === "object") {
    return objectKeysFromJsonSchema(node);
  }
  if (node["type"] === "array") {
    return nestedKeysFromJsonSchema(node["items"]);
  }
  return null;
}

function jsonSchemaProperties(node: unknown): Record<string, unknown> {
  if (!isRecord(node)) {
    return {};
  }
  const properties = node["properties"];
  return isRecord(properties) ? properties : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function peek(cursor: Cursor): string {
  const char = cursor.text[cursor.index];
  if (char === undefined) {
    throw new Error(`Unexpected end of contract at offset ${cursor.index}`);
  }
  return char;
}

function expectChar(cursor: Cursor, expected: string): void {
  const actual = peek(cursor);
  if (actual !== expected) {
    throw new Error(
      `Expected "${expected}" at offset ${cursor.index} but found "${actual}"`,
    );
  }
  cursor.index += 1;
}

function readQuoted(cursor: Cursor): string {
  expectChar(cursor, '"');
  const end = cursor.text.indexOf('"', cursor.index);
  if (end === -1) {
    throw new Error(`Unterminated key at offset ${cursor.index}`);
  }
  const key = cursor.text.slice(cursor.index, end);
  cursor.index = end + 1;
  return key;
}

function skipWhitespace(cursor: Cursor): void {
  while (cursor.index < cursor.text.length) {
    const char = cursor.text[cursor.index];
    if (char === undefined || !/\s/.test(char)) {
      return;
    }
    cursor.index += 1;
  }
}

/** Moves past a value's remainder up to its `,`, `}` or `]`. */
function skipToDelimiter(cursor: Cursor): void {
  while (cursor.index < cursor.text.length) {
    const char = cursor.text[cursor.index];
    if (char === "," || char === "}" || char === "]") {
      return;
    }
    cursor.index += 1;
  }
}

describe("prompt contract parity", () => {
  it("reads keys, nesting and lists out of a contract string", () => {
    const keys = parseContractKeys(`{
      "date": "YYYY-MM-DD",
      "type": "workout | rest",
      "progress": { "targetWeightKg": 0, "note": "string" } | null,
      "sessions": [
        {
          "day": "Monday",
          "estimatedFtpWatts": 0
        }
      ],
      "alternatives": ["string"],
      "optional": false
    }`);

    expect([...keys.keys()]).toEqual([
      "date",
      "type",
      "progress",
      "sessions",
      "alternatives",
      "optional",
    ]);
    expect([...(keys.get("progress")?.keys() ?? [])]).toEqual([
      "targetWeightKg",
      "note",
    ]);
    expect([...(keys.get("sessions")?.keys() ?? [])]).toEqual([
      "day",
      "estimatedFtpWatts",
    ]);
    expect(keys.get("alternatives")).toBeNull();
    expect(keys.get("optional")).toBeNull();
  });

  it("reports a schema key the contract never asks for", () => {
    const problems = contractMismatches({
      contractName: "TEST_CONTRACT",
      contract: `{ "date": "YYYY-MM-DD" }`,
      schemaName: "testSchema",
      schema: schemaKeys(z.object({ date: z.string(), added: z.string() })),
    });

    expect(problems).toEqual([
      'TEST_CONTRACT: the contract is missing "added", which testSchema accepts',
    ]);
  });

  it("reports a contract key the schema does not accept", () => {
    const problems = contractMismatches({
      contractName: "TEST_CONTRACT",
      contract: `{ "date": "YYYY-MM-DD", "removed": 0 }`,
      schemaName: "testSchema",
      schema: schemaKeys(z.object({ date: z.string() })),
    });

    expect(problems).toEqual([
      'TEST_CONTRACT: the contract has "removed", which testSchema does not accept',
    ]);
  });

  it("reports a nested mismatch under its path", () => {
    const problems = contractMismatches({
      contractName: "TEST_CONTRACT",
      contract: `{ "sessions": [{ "date": "YYYY-MM-DD" }] }`,
      schemaName: "testSchema",
      schema: schemaKeys(
        z.object({
          sessions: z.array(z.object({ date: z.string(), day: z.string() })),
        }),
      ),
    });

    expect(problems).toEqual([
      'TEST_CONTRACT["sessions"]: the contract is missing "day", which testSchema accepts',
    ]);
  });

  it("reports an object on one side and a value on the other", () => {
    const problems = contractMismatches({
      contractName: "TEST_CONTRACT",
      contract: `{ "detail": { "note": "string" } }`,
      schemaName: "testSchema",
      schema: schemaKeys(z.object({ detail: z.string() })),
    });

    expect(problems).toEqual([
      'TEST_CONTRACT: "detail" is an object in the contract and a value in testSchema',
    ]);
  });

  it("allows the keys the API adds after the coach responds", () => {
    const problems = contractMismatches({
      contractName: "TEST_CONTRACT",
      contract: `{ "date": "YYYY-MM-DD" }`,
      schemaName: "testSchema",
      schema: schemaKeys(z.object({ date: z.string(), attached: z.number() })),
      serverKeys: { "": ["attached"] },
    });

    expect(problems).toEqual([]);
  });

  for (const mapping of CONTRACT_MAPPINGS) {
    it(`${mapping.contractName} matches ${mapping.schemaName}`, () => {
      expect(contractMismatches(mapping)).toEqual([]);
    });
  }
});
