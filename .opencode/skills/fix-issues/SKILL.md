---
name: Fix Issues
description: Pick the ten highest-priority open GitHub issues, solve each one in its own fresh sub-session, open one pull request per issue, link them into one native GitHub stack, and report how a human approves and merges it.
---

# Fix Issues

Turn the ten highest-priority open GitHub issues into ten pull requests, stacked
one on top of the next, and link them into one native GitHub stack. Each pull
request is based on the previous pull request's branch, so one fix may build on
another and the batch can still deliver all ten issues instead of dropping the
ones that share files or depend on each other.

A chained base branch alone does not make a stack on GitHub. Until the pull
requests are linked into a stack, merging one only updates the branch beneath
it and the layers above never reach `main`. Step 6 links the batch so a human
can land all of it with one merge.

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
   > being delivered as a native GitHub stack of pull requests that a human
   > merges from the top: this issue's branch is based on `<base-branch>`, which
   > already contains the earlier fixes in the batch (`<issue numbers>`). Do not
   > work on another issue. You may change a file an earlier fix already changed,
   > but do not undo or rewrite that fix; build on it. Do not push to, amend,
   > rebase or force-push the base branch. Start from the tip of `<base-branch>`
   > with a clean tree. Take ADR number `<n>` and migration slot `<n>` if this
   > fix needs one. Run every static check the issue makes relevant, not only the
   > default ones, and make them all pass. If a failure comes only from code
   > already on the base branch, report it instead of fixing it here. If the area
   > has no lint, type, or other static check at all, add the missing check to CI
   > and make that pass too. Open a pull request against `<base-branch>` when the
   > change is verified. Do not merge it and do not change its base branch: the
   > batch links every pull request into one GitHub stack at the end. Then reply
   > with the issue number, the branch, the base branch, a one-line summary, the
   > checks you ran, any check you added, and the pull request URL.

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

### 6. Link the batch into one GitHub stack

The finished batch is a chain of ordinary pull requests until GitHub is told
they form a stack. Do this once, after the last sub-session has reported, and
never merge the batch yourself: the human reviews and merges it.

1. Install the extension once if `gh extension list` does not already show
   `stack`:

   ```sh
   gh extension install github/gh-stack
   ```

2. Link every pull request of the batch, **bottom to top**, by number:

   ```sh
   gh stack link <bottom-pr> <next-pr> … <top-pr>
   ```

   Pass the whole batch in stack order and never a subset. `link` checks that
   each pull request's base ref is the previous pull request's head ref,
   corrects a base ref that does not chain, and creates the stack object (or
   appends to one that already exists).

3. Read the stack back and keep the number for the report:

   ```sh
   REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
   gh api "repos/$REPO/stacks?pull_request=<bottom-pr>" \
     --jq '.[0] | {number, base: .base.ref, pull_requests: [.pull_requests[].number]}'
   ```

   The stack order must match the batch order and `base` must be `main`. If
   `link` refuses the batch, the order or a base ref is wrong: list the pull
   requests bottom to top and make sure each base is the previous pull request's
   branch, never `main`. Fix it and run `gh stack link` again. Never merge a
   pull request to work around a failed link.

4. If the extension cannot be installed or GitHub refuses the stack, say so in
   the report and mark the batch as unstacked: the human must then merge bottom
   up and retarget each next pull request to `main` after every merge.

### 7. Report back

Give one row per issue **in stack order** with the issue number and title, the
branch, the base branch it was opened against, the pull request URL, or the
reason it was skipped, plus the checks that ran. Each row must list the
issue-specific static checks, not only `typecheck`, `lint`, `format`, and
`test`, and any check the fix added to CI, plus which files those shared
additions touched, so a thin gate is visible before review. State the merge
order explicitly and give the stack number and page URL
(`https://github.com/<owner>/<repo>/stack/<number>`), or say that the batch
could not be stacked. If an issue near the bottom is rejected, say which pull
requests must then be rebased.

Finish by printing the manual approval and merge steps for this stack, in this
shape:

> **Approve and merge the stack**
>
> Stack page: `<url>`
>
> 1. Open the stack page and review each layer's own diff. The stack map at the
>    top of every pull request shows where that layer sits and moves between
>    layers.
> 2. Approve every pull request. The merge is all-or-nothing: a pull request
>    only merges once every pull request below it is approved and its checks
>    are green, and the branch protection for `main` applies to every layer.
> 3. Merge the whole batch: open the **top** pull request, click **Merge pull
>    request**, and pick the merge method. GitHub lands every unmerged layer
>    below it on `main` in one atomic operation, one commit per pull request,
>    and every `Closes #N` fires. This is the normal path.
> 4. Merge only part of the batch: open a lower pull request and merge it. It
>    lands with every pull request below it, and the ones above it are rebased
>    and retargeted onto `main` automatically, so they stay mergeable.
> 5. If GitHub shows **Rebase stack** because `main` moved while the stack was
>    open, click it (or run `gh stack sync`) before merging.
> 6. Do not merge a stacked pull request with `gh pr merge` or the synchronous
>    merge API, because neither can merge a stack. Use the button,
>    `gh stack merge <pr> --squash --yes`, or the async merge API
>    (`PUT /repos/<owner>/<repo>/pulls/<n>/merge-async`, then poll the returned
>    request id).

Name the explicit merge order as well, so a reviewer can land a lower group
first if they prefer. Do not close issues by hand; merging the stack closes each
one.

## Rules

- One issue per branch and pull request. Never combine two issues into one
  branch to save work, and never let one sub-session fix two issues.
- Each pull request is based on the previous one and opened against that
  branch, not against `main`. The first pull request of the stack is the only
  one based on `main`: a stack's trunk is its bottom pull request's base, so a
  bottom pull request based on another fix branch would strand the whole batch.
- Link the whole batch into one stack and leave merging to the human. Never
  merge it yourself, never use `gh pr merge` on a stack member, and never work
  around a failed link by merging.
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
