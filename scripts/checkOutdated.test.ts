import { describe, expect, it } from "bun:test";

import { parseOutdatedOutput } from "./check-outdated";

// Every fixture below is real `bun outdated` output captured with Bun 1.4.4,
// the version pinned in the CI test job. Bun 1.4 offers no machine-readable
// output for `bun outdated` (`bun outdated --help` lists no such flag, and no
// `bun pm` command reports the registry's available versions), so the check
// reads this table. Pinning it here means a change to Bun's layout fails a test
// instead of letting the parser read a new format as "everything is up to
// date".
const WORKSPACE_TABLE = [
  "bun outdated v1.4.4 (38afee6c8)",
  "|----------------------------------------------------|",
  "| Package    | Current | Update | Latest | Workspace |",
  "|------------|---------|--------|--------|-----------|",
  "| clsx       | 2.0.0   | 2.0.0  | 2.1.1  | @x/a      |",
  "|------------|---------|--------|--------|-----------|",
  "| picocolors | 1.0.0   | 1.0.0  | 1.1.1  | @x/b      |",
  "|----------------------------------------------------|",
].join("\n");

const SINGLE_PROJECT_TABLE = [
  "bun outdated v1.4.4 (38afee6c8)",
  "|----------------------------------------|",
  "| Package    | Current | Update | Latest |",
  "|------------|---------|--------|--------|",
  "| clsx       | 2.0.0   | 2.0.0  | 2.1.1  |",
  "|------------|---------|--------|--------|",
  "| picocolors | 1.0.0   | 1.0.0  | 1.1.1  |",
  "|----------------------------------------|",
].join("\n");

const UP_TO_DATE = "bun outdated v1.4.4 (38afee6c8)";

describe("parseOutdatedOutput", () => {
  it("reads every row of a recursive table", () => {
    expect(parseOutdatedOutput(WORKSPACE_TABLE)).toEqual({
      kind: "outdated",
      packages: [
        {
          package: "clsx",
          current: "2.0.0",
          update: "2.0.0",
          latest: "2.1.1",
          workspace: "@x/a",
        },
        {
          package: "picocolors",
          current: "1.0.0",
          update: "1.0.0",
          latest: "1.1.1",
          workspace: "@x/b",
        },
      ],
    });
  });

  it("reads a table without the workspace column", () => {
    expect(parseOutdatedOutput(SINGLE_PROJECT_TABLE)).toEqual({
      kind: "outdated",
      packages: [
        {
          package: "clsx",
          current: "2.0.0",
          update: "2.0.0",
          latest: "2.1.1",
          workspace: null,
        },
        {
          package: "picocolors",
          current: "1.0.0",
          update: "1.0.0",
          latest: "1.1.1",
          workspace: null,
        },
      ],
    });
  });

  it("treats the version banner alone as up to date", () => {
    // `bun outdated` prints its banner even when nothing is outdated.
    expect(parseOutdatedOutput(UP_TO_DATE)).toEqual({ kind: "up-to-date" });
    expect(parseOutdatedOutput(`${UP_TO_DATE}\n`)).toEqual({
      kind: "up-to-date",
    });
  });

  it("ignores the colour codes Bun writes to a terminal", () => {
    const colour = (line: string): string => `\u001b[32m${line}\u001b[0m`;
    const painted = WORKSPACE_TABLE.split("\n").map(colour).join("\n");
    expect(parseOutdatedOutput(painted)).toEqual(
      parseOutdatedOutput(WORKSPACE_TABLE),
    );
  });

  it("reports a table it cannot read instead of passing it", () => {
    // A layout change must fail the check loudly. Reporting "up to date" here
    // would hide an outdated dependency forever.
    const renamed = WORKSPACE_TABLE.replace(
      "| Package    | Current | Update | Latest | Workspace |",
      "| Name       | Pinned  | Wanted | Newest | Workspace |",
    );
    expect(parseOutdatedOutput(renamed).kind).toBe("unrecognised");
  });

  it("reports a header without rows instead of passing it", () => {
    const headerOnly = [
      "bun outdated v1.4.4 (38afee6c8)",
      "|----------------------------------------|",
      "| Package    | Current | Update | Latest |",
      "|------------|---------|--------|--------|",
      "|----------------------------------------|",
    ].join("\n");
    expect(parseOutdatedOutput(headerOnly).kind).toBe("unrecognised");
  });

  it("reports unexpected output instead of passing it", () => {
    expect(parseOutdatedOutput("error: registry unavailable").kind).toBe(
      "unrecognised",
    );
    expect(parseOutdatedOutput("").kind).toBe("unrecognised");
  });
});
