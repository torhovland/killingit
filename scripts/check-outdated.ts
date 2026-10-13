#!/usr/bin/env bun
//
// Fails the build when any dependency is outdated.
//
// `bun outdated -r` prints a human-readable table listing every dependency
// that has a newer version available. This script shells out to it and exits
// non-zero when the table is non-empty, so CI can block builds on stale deps.
//
// When it fails, update the outdated dependencies (bun update) and commit the
// regenerated bun.lock in a separate commit. See AGENTS.md.

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

// The "bun outdated" table uses box-drawing / markdown-style separators. When
// there is nothing to report, the body is empty (or contains only a message
// like "No outdated packages"). Treat any remaining non-empty output as an
// outdated dependency.
if (output === "" || /no outdated packages/i.test(output)) {
  console.log("All dependencies are up to date.");
  process.exit(0);
}

console.error("Outdated dependencies found:\n");
console.error(output);
console.error(
  "\nUpdate them (bun update), then commit the regenerated bun.lock and " +
    "package.json changes in a new commit before pushing.",
);
process.exit(1);
