---
name: Fix Issue
description: Pick the highest-priority open GitHub issue in this repository, fix it on a branch, verify it, and open a pull request.
---

# Fix Issue

Turn one open GitHub issue into a reviewed pull request, highest priority
first.

## Workflow

### 1. Check the working tree

Run `git status --short` and note anything unrelated to the issue. Leave those
files exactly as they are: do not modify, stash, delete, or commit them. Never
fold unrelated work into the fix. If the unrelated changes would block the fix
(for example a file the issue must edit already has conflicting local edits),
comment on the issue with the situation and stop.

### 2. Pick the issue

- If the user named an issue number, use that one.
- Otherwise run this skill's `scripts/next-issue.sh`. It prints the open issue
  to fix next: `priority: high`, then `priority: medium`, then `priority: low`,
  then unlabelled, with ties going to the oldest issue. Use `--list` to see the
  ordered backlog, `--label LABEL` to stay within one kind of work, and
  `--json` for machine-readable output.

Do not ask for confirmation. Once the issue is identified by this ordering,
start working on it.

### 3. Read the issue fully

Run `gh issue view <number> --comments`. Read the files, specs, and ADRs it
references.

If the issue is stale, already fixed, or too ambiguous to implement safely,
comment on the issue with your questions or findings and stop. Do not guess.

### 4. Branch from the default branch

```sh
git fetch origin
git switch --create fix/<number>-<short-slug> origin/main
```

One issue per branch. Never commit directly to `main` and never rewrite history.

### 5. Spec before code

For anything non-trivial, write or update a short spec in `docs/specs/` (goal,
scope, acceptance criteria, data-model and API impact) before implementing.
Record architectural decisions as a new ADR in `docs/adrs/`. For refactors,
state the target structure in the issue or the spec.

### 6. Test-driven development

Write the failing test first for new behavior, then implement until it passes.
Keep the change to one logical concern, follow the surrounding code patterns,
and extend shared modules instead of duplicating them. Do not leave dead or
commented-out code behind.

### 7. Verify the change

Run all of these and fix any failure:

```sh
bun run typecheck
bun run lint
bun run format
bun run test
```

Use `bun run lint:fix` and `bun run format:fix` to apply mechanical fixes, then
re-run the checks. If you changed dependencies, follow AGENTS.md: update with
`bun update`, commit `bun.lock` separately, and make sure `bun run outdated`
passes.

### 8. Keep the documents current

Update `AGENTS.md` and the affected `docs/specs/*.md` whenever behavior,
prompts, routes, schema, or workflow changes. Do not describe the project as
open source or touch the licence notice.

### 9. Commit and open the pull request

```sh
git add <only the files you changed>
git commit -m "<focused message>"
git push -u origin fix/<number>-<short-slug>
gh pr create --fill
```

Stage files explicitly. Never use `git add -A` or `git commit -a`: unrelated
files that were already in the working tree must stay uncommitted and out of
the PR. Before committing, re-run `git status --short` and confirm every staged
file belongs to the fix.

Edit the PR body to include `Closes #<number>`, a short summary of the fix, and
the checks you ran. Then watch CI and fix anything it reports:

```sh
gh pr checks --watch
```

Do not close the issue by hand; merging the PR closes it.

### 10. Report back

Give the issue number and title, the branch, a one-line summary of the change,
the checks you ran, and the PR URL.

## Rules

- One issue per branch and PR. If you find an unrelated bug, open a new issue
  with `gh issue create` and leave it out of this PR.
- Unrelated changes already in the working tree are not yours to touch. Leave
  them uncommitted and out of the PR; never revert or clean them.
- If the fix is much larger than the issue implies, stop and comment on the
  issue with the plan and scope before spending a large effort.
- Follow `AGENTS.md` throughout: strict TypeScript, no duplicated prompt
  fragments, no second licence, and every change covered by tests.
