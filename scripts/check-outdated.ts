#!/usr/bin/env bun
//
// Fails the build when any dependency is outdated.
//
// `bun outdated -r` prints a human-readable table listing every dependency
// that has a newer version available. This script shells out to it and exits
// non-zero when the table is non-empty, so CI can block builds on stale deps.
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

const proc = Bun.spawnSync(["bun", "outdated", "-r"], {
  stdout: "pipe",
  stderr: "pipe",
});

const output = new TextDecoder().decode(proc.stdout).trim();
const stderr = new TextDecoder().decode(proc.stderr).trim();

if (proc.exitCode !== 0) {
  console.error(stderr || output);
  console.error("bun outdated failed with exit code", proc.exitCode);
  process.exit(proc.exitCode);
}

if (stderr) {
  console.error(stderr);
}

// `bun outdated` prints a version banner ("bun outdated vX.Y.Z (...)") on
// stdout even when nothing is outdated, so "empty output" is not a reliable
// signal. The marker of a real report is the table header row that begins
// with "| Package". When it is absent, there is nothing outdated. Also accept
// an empty body or an explicit "no outdated packages" message.
const hasTable = /\| Package\b/.test(output);
if (!hasTable || /no outdated packages/i.test(output)) {
  console.log("All dependencies are up to date.");
  process.exit(0);
}

console.error("Outdated dependencies found:\n");
console.error(output);
console.error(
  "\nUpdate them, then commit the regenerated bun.lock and package.json " +
    "changes in a new commit before pushing.\n\n" +
    'The table\'s "Update" column is the newest version allowed by the ' +
    'declared semver range; run `bun update` to apply those. The "Latest" ' +
    "column is the newest published version (major-version bumps); run " +
    "`bun update --latest` (or `bun update -i`) to apply those.",
);
process.exit(1);
