#!/usr/bin/env bun
//
// Reports dependencies that have a newer version available.
//
// This is not a pull-request gate: a pull request's result must not depend on
// whether some dependency published a release while it was open. The check
// runs from the scheduled `outdated` workflow instead, and a developer can run
// the same command locally. See `docs/specs/dependency-freshness.md`.
//
// `bun outdated -r` prints a human-readable table listing every dependency in
// every workspace that has a newer version available. Bun 1.4 has no
// machine-readable output for it (`bun outdated --help` lists no such flag, and
// no `bun pm` command reports the registry's available versions), so the table
// is the only interface there is and this script reads it. The parse fails
// loudly on output it does not recognise instead of reporting "up to date", so
// a changed Bun layout is reported rather than silently accepted;
// `scripts/checkOutdated.test.ts` pins the captured layout.
//
// The table has two version columns: "Update" (newest version within the
// semver range in package.json) and "Latest" (newest on the registry,
// ignoring ranges). Plain `bun update` only upgrades within the declared
// range, so it resolves the "Update" column only. Entries whose difference is
// in the "Latest" column (major-version jumps) require `bun update --latest`
// (or `bun update -i`) to resolve.
//
// When it fails, update the outdated dependencies and commit the regenerated
// bun.lock in a separate commit. See AGENTS.md.

export interface OutdatedPackage {
  package: string;
  current: string;
  update: string;
  latest: string;
  /** The workspace that declares the dependency, when Bun prints the column. */
  workspace: string | null;
}

export type OutdatedReport =
  | { kind: "up-to-date" }
  | { kind: "outdated"; packages: OutdatedPackage[] }
  | { kind: "unrecognised"; output: string };

/** The columns the report needs; a missing one means the layout changed. */
const REQUIRED_COLUMNS = ["Package", "Current", "Update", "Latest"] as const;

/** The control character Bun writes around a coloured cell on a terminal. */
const ESCAPE = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESCAPE}\\[[0-9;]*m`, "g");
const BANNER_PATTERN = /^bun outdated v\d/;
const SEPARATOR_PATTERN = /^\|[-|]+\|$/;

/**
 * Reads `bun outdated -r` output. Bun's only "nothing is outdated" output is
 * its version banner, so a banner and nothing else is the up-to-date case and
 * anything the parser cannot classify is reported as unrecognised.
 */
export function parseOutdatedOutput(output: string): OutdatedReport {
  const plain = output.replace(ANSI_PATTERN, "");
  const packages: OutdatedPackage[] = [];
  let header: string[] | null = null;
  let sawBanner = false;
  let unexpected = false;

  for (const rawLine of plain.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || SEPARATOR_PATTERN.test(line)) {
      continue;
    }
    if (BANNER_PATTERN.test(line)) {
      sawBanner = true;
      continue;
    }
    if (!line.startsWith("|") || !line.endsWith("|")) {
      // The banner and the table are the whole report; a progress note, a
      // warning or a renamed table header lands here.
      unexpected = true;
      continue;
    }
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (cells[0] === "Package") {
      if (!hasRequiredColumns(cells)) {
        unexpected = true;
      } else {
        // Bun prints one table; a second header would start another.
        header = cells;
      }
      continue;
    }
    if (header === null || cells.length !== header.length) {
      unexpected = true;
      continue;
    }
    const entry = readPackage(header, cells);
    if (entry === null) {
      unexpected = true;
      continue;
    }
    packages.push(entry);
  }

  if (unexpected || (header !== null && packages.length === 0)) {
    return { kind: "unrecognised", output: plain.trim() };
  }
  if (header === null) {
    // Bun prints its banner even when nothing is outdated, so the banner alone
    // is the up-to-date case. Silence is not that case: an invocation that
    // printed nothing is reported rather than trusted.
    return sawBanner
      ? { kind: "up-to-date" }
      : { kind: "unrecognised", output: plain.trim() };
  }
  return { kind: "outdated", packages };
}

function hasRequiredColumns(header: readonly string[]): boolean {
  return REQUIRED_COLUMNS.every((column) => header.includes(column));
}

/** One table row, or null when a required cell is missing. */
function readPackage(
  header: readonly string[],
  cells: readonly string[],
): OutdatedPackage | null {
  const cell = (column: string): string => {
    const index = header.indexOf(column);
    return index < 0 ? "" : (cells[index] ?? "");
  };
  const entry: OutdatedPackage = {
    package: cell("Package"),
    current: cell("Current"),
    update: cell("Update"),
    latest: cell("Latest"),
    workspace: header.includes("Workspace") ? cell("Workspace") : null,
  };
  const empty =
    entry.package === "" ||
    entry.current === "" ||
    entry.update === "" ||
    entry.latest === "" ||
    entry.workspace === "";
  return empty ? null : entry;
}

if (import.meta.main) {
  main();
}

function main(): void {
  const proc = Bun.spawnSync(["bun", "outdated", "-r"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = new TextDecoder().decode(proc.stdout);
  const stderr = new TextDecoder().decode(proc.stderr).trim();

  if (stderr) {
    console.error(stderr);
  }

  if (proc.exitCode !== 0) {
    console.error("`bun outdated` failed with exit code", proc.exitCode);
    process.exit(1);
  }

  const report = parseOutdatedOutput(output);

  if (report.kind === "up-to-date") {
    console.log("All dependencies are up to date.");
    process.exit(0);
  }

  if (report.kind === "unrecognised") {
    console.error(
      "Could not read the output of `bun outdated`, so this check cannot say " +
        "whether every dependency is current.\n\n" +
        "It fails instead of reporting them as up to date, because a changed " +
        "table layout must not hide an outdated dependency. Update the parser " +
        "in scripts/check-outdated.ts and the captured output in " +
        "scripts/checkOutdated.test.ts.\n",
    );
    console.error(report.output);
    process.exit(1);
  }

  console.error("Outdated dependencies found:\n");
  console.error(output.trim());
  console.error(
    "\nUpdate them, then commit the regenerated bun.lock and package.json " +
      "changes in a new commit before pushing.\n\n" +
      'The table\'s "Update" column is the newest version allowed by the ' +
      'declared semver range; run `bun update` to apply those. The "Latest" ' +
      "column is the newest published version (major-version bumps); run " +
      "`bun update --latest` (or `bun update -i`) to apply those.",
  );
  process.exit(1);
}
