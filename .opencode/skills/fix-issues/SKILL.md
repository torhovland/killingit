---
name: Fix Issues
description: Pick the ten highest-priority open GitHub issues that can be fixed independently, solve each one in its own fresh sub-session, and open one pull request per issue.
---

# Fix Issues

Turn up to ten of the highest-priority open GitHub issues into separate pull
requests, each of which can be merged on its own.

## Workflow

### 1. Check the working tree

Run `git status --short` and note anything unrelated to these issues. Leave those
files exactly as they are: do not modify, stash, delete, or commit them. Never
fold unrelated work into a fix. If the unrelated changes would block an issue
(for example a file that issue must edit already has conflicting local edits),
comment on that issue with the situation and skip it.

### 2. Pick the batch

- If the user named issue numbers, use those.
- Otherwise run this skill's `scripts/next-issues.sh --list` and take the first
  ten rows. Issues are ordered by `priority: high`, then `priority: medium`,
  then `priority: low`, then unlabelled, with ties going to the oldest issue.
  Use `--label LABEL` to stay within one kind of work.

Do not backfill from below the top ten: if an issue is skipped, the batch gets
smaller instead of padded with lower-priority work. Do not ask for confirmation
before starting.

### 3. Read every issue in the batch

Run `gh issue view <number> --comments` for each issue and read the files,
specs, and ADRs it references. Build a picture of what each fix would touch.

If an issue is stale, already fixed, or too ambiguous to implement safely, it is
out of the batch: comment on it with your questions or findings and skip it. Do
not guess.

### 4. Filter for independence

Every pull request in the batch must be mergeable on its own, in any order. Two
issues are independent only when all of these hold:

- **No functional dependency.** Neither fix needs the other's code, schema,
  route or test helper to be correct or to build. When one issue says to do it
  after another, keep the earlier one and skip the later one.
- **No shared edit.** Their changes touch disjoint files. Editing the same file
  is a conflict unless the edits land in clearly separate, non-overlapping
  regions. Be strict with the files where one change can change the meaning of
  the other: the prompt fragments in `apps/api/src/llm/promptRules.ts`, the
  shared Zod schemas in `packages/shared`, the Drizzle schema and migrations,
  and the web component primitives. Documentation is independent only when the
  two issues touch clearly different sections of `AGENTS.md`,
  `docs/specs/*.md`, or `docs/adrs/*.md`.
- **No shared number.** Two issues that would each need a new ADR or a new
  migration compete for the same slot even when their files differ. Keep only
  the more important one.
- **No shared surface.** Two fixes that change the same user-visible behaviour
  from opposite directions cannot both be judged on their own; keep one.

Walk the batch in priority order and keep each issue whose files do not clash
with an issue already kept. That yields the largest independent subset of the
ten most important issues. Record why each skipped issue was skipped.

If nothing survives, report that and stop.

### 5. Solve each issue in its own sub-session

Work through the kept issues **one at a time, in priority order**. Never run two
sub-sessions in parallel: they share this working directory and its git
checkout, so overlapping work would corrupt both branches.

For each issue:

1. Re-check independence against the issues already handled in this batch; the
   remote or the issue text may have moved since step 4.
2. Start a fresh sub-session with the `subagent` tool (`agent: general`). The
   sub-session inherits no context, so the prompt must carry everything it
   needs:

   > Read `.opencode/skills/fix-issues/WORKFLOW.md` and follow it exactly to fix
   > GitHub issue #<number> in this repository. The issue is one of a batch of
   > independent fixes: do not touch another issue's files and do not work on
   > another issue. Start from a clean tree and from `origin/main`. Open a pull
   > request when the change is verified, then reply with the issue number, the
   > branch, a one-line summary, the checks you ran, and the pull request URL.

3. Wait for the sub-session to finish and read its report.
4. Confirm it left the working tree clean and that its branch contains only
   that issue's changes (`git status --short` and
   `git log origin/main..HEAD --stat`). If it folded in unrelated work or
   stopped without a pull request, resolve that before moving on. Never start
   the next issue on a dirty tree.
5. Run the independence check again for the remaining issues, because a
   finished pull request can reveal a shared file that the issue text did not
   mention. Skip anything that now clashes and say why.

`WORKFLOW.md` is the single-issue procedure: working-tree hygiene, spec,
test-driven development, verification, documentation, commit, and pull request.
A sub-session that finds its issue stale, ambiguous, or much larger than it
looks comments on the issue and reports back instead of guessing.

### 6. Report back

Give one row per issue in the batch with the issue number and title, the pull
request URL, or the reason it was skipped, plus the checks that ran.

Do not close issues by hand; merging each pull request closes its own.

## Rules

- One issue per branch and pull request. Never combine two issues into one
  branch to save work, and never let one sub-session fix two issues.
- Unrelated changes already in the working tree are not yours to touch. Leave
  them uncommitted and out of every pull request; never revert or clean them.
- If an issue turns out to be much larger than it looked in the batch, skip it
  and comment on it with the plan and scope rather than spending a large effort
  on a pull request that cannot be reviewed independently.
- Follow `AGENTS.md` throughout: strict TypeScript, no duplicated prompt
  fragments, no second licence, and every change covered by tests.
