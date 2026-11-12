# Workflow: fix one issue

This is the single-issue procedure. The batch skill
(`.opencode/skills/fix-issues/SKILL.md`) runs one sub-session per issue and
tells each sub-session which issue to fix. Work only on that issue: another
sub-session is handling every other issue in the batch, and the value of the
batch is that each pull request can be merged on its own.

## 1. Check the working tree

Run `git status --short` and note anything unrelated to the issue. Leave those
files exactly as they are: do not modify, stash, delete, or commit them. Never
fold unrelated work into the fix. If the unrelated changes would block the fix
(for example a file the issue must edit already has conflicting local edits),
comment on the issue with the situation and report back without a pull request.

## 2. Read the issue fully

Run `gh issue view <number> --comments`. Read the files, specs, and ADRs it
references.

If the issue is stale, already fixed, or too ambiguous to implement safely,
comment on the issue with your questions or findings and report back. Do not
guess.

## 3. Branch from the default branch

```sh
git fetch origin
git switch --create fix/<number>-<short-slug> origin/main
```

One issue per branch. Never commit directly to `main` and never rewrite history.

## 4. Check independence once more

Before writing code, list the files you expect to change. If the fix needs a
change to shared ground that another issue in the batch also needs — a prompt
fragment in `apps/api/src/llm/promptRules.ts`, a shared Zod schema, the database
schema, a spec both issues would edit, or the next ADR number — stop. Comment on
the issue with the overlap and report back without a pull request. Two pull
requests that collide cannot be merged independently, and a silently duplicated
fragment is worse than a skipped issue.

## 5. Spec before code

For anything non-trivial, write or update a short spec in `docs/specs/` (goal,
scope, acceptance criteria, data-model and API impact) before implementing.
Record architectural decisions as a new ADR in `docs/adrs/`. For refactors,
state the target structure in the issue or the spec.

## 6. Test-driven development

Write the failing test first for new behavior, then implement until it passes.
Keep the change to one logical concern, follow the surrounding code patterns,
and extend shared modules instead of duplicating them. Do not leave dead or
commented-out code behind.

## 7. Verify the change

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

## 8. Keep the documents current

Update `AGENTS.md` and the affected `docs/specs/*.md` whenever behavior,
prompts, routes, schema, or workflow changes. Do not describe the project as
open source or touch the licence notice.

## 9. Commit and open the pull request

```sh
git add <only the files you changed>
git commit -m "<focused message>"
git push -u origin fix/<number>-<short-slug>
gh pr create --fill
```

Stage files explicitly. Never use `git add -A` or `git commit -a`: unrelated
files that were already in the working tree must stay uncommitted and out of
the pull request. Before committing, re-run `git status --short` and confirm
every staged file belongs to the fix.

Edit the pull request body to include `Closes #<number>`, a short summary of the
fix, and the checks you ran. Then watch CI and fix anything it reports:

```sh
gh pr checks --watch
```

Do not close the issue by hand; merging the pull request closes it.

## 10. Report back

Reply with the issue number and title, the branch, a one-line summary of the
change, the checks you ran, and the pull request URL. If you stopped without a
pull request, say exactly where you stopped and why.
