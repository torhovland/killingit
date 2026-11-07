#!/usr/bin/env bun
//
// Fails when a pull request carries a commit without a `Signed-off-by:`
// trailer. The sign-off records that its author may contribute the change
// under the project's terms, which only means something for someone other than
// the copyright holder, so the owner's own commits are exempt. Merge commits
// are exempt too: they introduce no contribution of their own.
//
// Usage: `bun run scripts/check-signoff.ts [<base-ref>]`, defaulting to
// `origin/main`. Only the commits between the base and HEAD are checked, so
// history that predates the rule never fails the build.
//
// See CONTRIBUTING.md.

import {
  GIT_LOG_FORMAT,
  OWNER_EMAILS,
  parseGitLog,
  unsignedCommits,
} from "./signoff";

const base = process.argv[2] ?? "origin/main";

function exemptEmails(): string[] {
  const extra = (process.env.DCO_EXEMPT_AUTHORS ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter((email) => email !== "");
  return [...OWNER_EMAILS, ...extra];
}

const result = Bun.spawnSync(
  ["git", "log", `--format=${GIT_LOG_FORMAT}`, `${base}..HEAD`],
  {
    stdout: "pipe",
    stderr: "pipe",
  },
);

if (result.exitCode !== 0) {
  const stderr = new TextDecoder().decode(result.stderr).trim();
  console.error(stderr || `git log ${base}..HEAD failed`);
  console.error(
    `Could not check sign-offs against "${base}". Fetch it first, for example: git fetch origin main`,
  );
  process.exit(1);
}

const commits = parseGitLog(new TextDecoder().decode(result.stdout));
const unsigned = unsignedCommits(commits, exemptEmails());

if (unsigned.length === 0) {
  console.log(`Sign-off check passed for ${commits.length} commit(s).`);
  process.exit(0);
}

console.error("These commits have no sign-off:");
for (const commit of unsigned) {
  console.error(`  ${commit.hash.slice(0, 12)} by ${commit.authorEmail}`);
}
console.error("");
console.error(
  "Add it with `git commit --amend -s` (or `git rebase --signoff`),",
);
console.error(
  "or open the pull request without the commit. See CONTRIBUTING.md.",
);
process.exit(1);
