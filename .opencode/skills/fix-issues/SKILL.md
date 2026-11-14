---
name: Fix Issues
description: Pick the ten highest-priority open GitHub issues, solve each one in its own fresh sub-session, and open one pull request per issue as a stack that is merged in order.
---

# Fix Issues

Turn the ten highest-priority open GitHub issues into ten pull requests, stacked
one on top of the next and merged serially. Each pull request is based on the
previous pull request's branch, so one fix may build on another and the batch
can still deliver all ten issues instead of dropping the ones that share files
or depend on each other.

## Workflow

### 1. Check the working tree

Run `git status --short` and note anything unrelated to these issues. Leave those
files exactly as they are: do not modify, stash, delete, or commit them. Never
fold unrelated work into a fix. If the unrelated changes are in a file an issue
must edit, the later fix is built on the clean committed state of the stack, not
on those uncommitted edits, so the sub-session stages only its own files and
leaves the rest alone.

### 2. Pick the batch

- If the user named issue numbers, use those, in the order given.
- Otherwise run this skill's `scripts/next-issues.sh --list` and take the first
  ten rows. Issues are ordered by `priority: high`, then `priority: medium`,
  then `priority: low`, then unlabelled, with ties going to the oldest issue.
  Use `--label LABEL` to stay within one kind of work.

Do not backfill from below the top ten: if an issue is dropped, the stack gets
shorter instead of padded with lower-priority work. Do not ask for confirmation
before starting.

### 3. Read every issue in the batch

Run `gh issue view <number> --comments` for each issue and read the files,
specs, and ADRs it references. Build a picture of what each fix would touch and
of how the fixes relate.

If an issue is stale, already fixed, or too ambiguous to implement safely, it is
out of the batch: comment on it with your questions or findings and skip it. Do
not guess.

### 4. Order the stack

The batch is a stack, so the order is a merge order, not a filter. The default
order is the priority order from step 2, because the most important fix should
land first and be reviewable without waiting behind the rest.

Adjust the order only where it buys something concrete, and record the reason:

- **Put a foundational issue first** when several later issues need it — a shared
  schema, a store, a helper, a migration, a CI check. That lets the later fixes
  build on it instead of each inventing its own copy.
- **Put an issue that only another issue makes possible** after its enabler. An
  issue that says "after #123" comes after #123, and the earlier one is no
  longer dropped.
- **Separate issues that change the same user-visible behaviour in opposite
  directions** only when the order between them is arbitrary; put the one whose
  behaviour the other assumes first.
- **Number shared resources in order.** When two issues each need a new ADR or a
  new migration, the first in the stack takes the next free number and the
  second takes the one after it. Say the number in each sub-session's prompt so
  they cannot collide.

Do not reorder for convenience of file layout. A fix touching a file an earlier
fix touched is expected now; the stack handles it by branching on top.

If nothing survives step 3, report that and stop.

### 5. Solve each issue in its own sub-session, in stack order

Work through the ordered issues **one at a time, in order**. Never run two
sub-sessions in parallel: they share this working directory and its git
checkout, and every branch in the stack is based on the previous one, so
overlapping work would corrupt the whole stack.

For each issue:

1. Determine the base branch: `main` for the first issue, otherwise the branch
   of the issue immediately before it in the stack.
2. Start a fresh sub-session with the `subagent` tool (`agent: general`). The
   sub-session inherits no context, so the prompt must carry everything it
   needs:

   > Read `.opencode/skills/fix-issues/WORKFLOW.md` and follow it exactly to fix
   > GitHub issue #<number> in this repository. The issues in this batch are
   > being delivered as a stack of pull requests that are merged serially in
   > order: this issue's branch is based on `<base-branch>`, which already
   > contains the earlier fixes in the batch (`<issue numbers>`). Do not work on
   > another issue. You may change a file an earlier fix already changed, but do
   > not undo or rewrite that fix; build on it. Do not push to, amend, rebase or
   > force-push the base branch. Start from the tip of `<base-branch>` with a
   > clean tree. Take ADR number `<n>` and migration slot `<n>` if this fix needs
   > one. Run every static check the issue makes relevant, not only the default
   > ones, and make them all pass. If a failure comes only from code already on
   > the base branch, report it instead of fixing it here. If the area has no
   > lint, type, or other static check at all, add the missing check to CI and
   > make that pass too. Open a pull request against `<base-branch>` when the
   > change is verified, then reply with the issue number, the branch, the base
   > branch, a one-line summary, the checks you ran, any check you added, and
   > the pull request URL.

3. Wait for the sub-session to finish and read its report.
4. Confirm it left the working tree clean, that its branch sits on top of the
   base branch, and that it contains only that issue's changes
   (`git status --short`, `git merge-base --is-ancestor <base> HEAD`, and
   `git log <base>..HEAD --stat`). If it folded in unrelated work or stopped
   without a pull request, resolve that before moving on. Never start the next
   issue on a dirty tree, and never build the next issue on a branch that does
   not contain the previous one.
5. If the sub-session reports a check that fails only because of the base
   branch, repair the base before continuing — push a small follow-up commit to
   that branch yourself, or start one short sub-session on it — so the stack
   never carries a red base. A later sub-session is never allowed to patch the
   branch beneath it.

`WORKFLOW.md` is the single-issue procedure: working-tree hygiene, branching on
the stack, spec, test-driven development, verification, documentation, commit,
and pull request. A sub-session that finds its issue stale, ambiguous, or much
larger than it looks comments on the issue and reports back instead of guessing.

### 6. Report back

Give one row per issue **in stack order** with the issue number and title, the
branch, the base branch it was opened against, the pull request URL, or the
reason it was skipped, plus the checks that ran. Each row must list the
issue-specific static checks, not only `typecheck`, `lint`, `format`, and
`test`, and any check the fix added to CI, plus which files those shared
additions touched, so a thin gate is visible before review. State the merge
order explicitly: the pull requests are only mergeable as a sequence, from the
bottom of the stack upwards. If an issue near the bottom is rejected, say which
pull requests must then be rebased.

Do not close issues by hand; merging each pull request closes its own.

## Rules

- One issue per branch and pull request. Never combine two issues into one
  branch to save work, and never let one sub-session fix two issues.
- Each pull request is based on the previous one and opened against that
  branch, not against `main`. The first pull request of the stack is the only
  one based on `main`.
- No pull request may contain another issue's work. Keep the diff of each one to
  its own issue, so a reviewer sees exactly that fix even though the branch
  carries the earlier fixes underneath.
- Never rewrite the history of an earlier pull request in the stack: no amend,
  rebase or force-push of a base branch from a later sub-session. A change that
  belongs to an earlier fix goes into a follow-up commit on that branch and is
  called out in its pull request.
- A shared file is not a reason to skip an issue any more. Two fixes may edit
  the same schema, prompt fragment, CI workflow or spec; the later one builds on
  the earlier one's version, extends it instead of duplicating it, and takes the
  next free ADR and migration number.
- Quality is not negotiable per issue: the sub-session runs every lint, type,
  coverage and other static check the fix attracts, adds the relevant check to
  CI when the area has none, and makes them all pass without weakening a rule
  or skipping a test to get green. A base branch that is already red is fixed
  before the stack continues.
- Unrelated changes already in the working tree are not yours to touch. Leave
  them uncommitted and out of every pull request; never revert or clean them.
- If an issue turns out to be much larger than it looked in the batch, drop it
  from the stack and comment on it with the plan and scope. Skipping one issue
  must not break the ones above it in the order; if it does, keep it or move the
  dependent issues below it.
- Follow `AGENTS.md` throughout: strict TypeScript, no duplicated prompt
  fragments, no second licence, and every change covered by tests.
