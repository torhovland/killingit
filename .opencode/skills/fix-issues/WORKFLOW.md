# Workflow: fix one issue

This is the single-issue procedure. The batch skill
(`.opencode/skills/fix-issues/SKILL.md`) runs one sub-session per issue and
tells each sub-session which issue to fix and which branch to build on. The
batch is a stack of pull requests merged serially in order: your branch sits on
top of the earlier fixes in the batch, so you will see their code in your
checkout. Work only on your own issue. You may change a file an earlier fix
already changed, but build on it instead of undoing it, and keep the diff of
your pull request to your own issue.

## 1. Check the working tree

Run `git status --short` and note anything unrelated to the issue. Leave those
files exactly as they are: do not modify, stash, delete, or commit them. Never
fold unrelated work into the fix. Stage only the files your fix changes, so the
pre-existing edits stay out of the pull request.

## 2. Read the issue fully

Run `gh issue view <number> --comments`. Read the files, specs, and ADRs it
references, including anything the earlier fixes in the batch added that the
issue now builds on.

If the issue is stale, already fixed, or too ambiguous to implement safely,
comment on the issue with your questions or findings and report back. Do not
guess.

## 3. Branch on top of the stack

The batch skill tells you the base branch: `main` for the first issue in the
stack, otherwise the branch of the previous issue.

```sh
git fetch origin
git switch --create fix/<number>-<short-slug> <base-branch>
```

Use the local base branch if it exists (the previous sub-session created it);
otherwise use `origin/<base-branch>`. Confirm the base is where you expect:

```sh
git log --oneline -n 5
```

One issue per branch. Never commit directly to `main`, never commit to the base
branch, and never rewrite history — no amend, rebase or force-push of a branch
that is not yours.

## 4. Check the stack base

Before writing code, list the files you expect to change and read what the
earlier fixes in the stack did to them. Shared ground is expected now, but it
must be extended, not duplicated:

- A prompt fragment in `apps/api/src/llm/promptRules.ts`: reuse and extend the
  export an earlier fix added. Never add a second copy of the same rule.
- A shared Zod schema, the Drizzle schema, or a migration: extend the existing
  table and column definitions, and take the migration number the batch skill
  reserved for you.
- Static-check and CI configuration (`eslint.config.js`, `tsconfig.base.json`,
  `knip.json`, `scripts/coverage.ts`, `package.json` scripts,
  `.github/workflows/ci.yml`): add your rule or step next to the earlier one and
  leave it in place.
- A spec or ADR: take the ADR number the batch skill reserved for you and edit
  the section your issue owns.

If the fix needs a change to what an earlier fix in the stack introduced — a
bug, a wrong default, a helper with the wrong shape — do not patch around it and
do not push to that branch. Comment on your issue with the overlap and report
back, so the batch fixes the base branch first and the stack does not carry a
workaround.

## 5. Spec before code

For anything non-trivial, write or update a short spec in `docs/specs/` (goal,
scope, acceptance criteria, data-model and API impact) before implementing.
Record architectural decisions as a new ADR in `docs/adrs/`, using the number
the batch skill reserved for you. For refactors, state the target structure in
the issue or the spec.

## 6. Test-driven development

Write the failing test first for new behavior, then implement until it passes.
Keep the change to one logical concern, follow the surrounding code patterns,
and extend shared modules instead of duplicating them. Do not leave dead or
commented-out code behind.

## 7. Verify the change

CI is strict, and a check that only fails after the push has already cost the
batch a round trip. Run the checks yourself, including every static check this
particular issue makes relevant, and make them all pass before committing.

Always run:

```sh
bun run typecheck
bun run lint
bun run format
bun run test
```

Then add the gate the change itself attracts, mirroring CI:

| The change touches                             | Also run                   |
| ---------------------------------------------- | -------------------------- |
| an export, a module, or the dependency graph   | `bun run check:unused`     |
| `services/garmin` or its tooling               | `bun run check:garmin`     |
| migrations, stores, constraints, cascades      | `bun run test:integration` |
| a user journey, a route, or a page             | `bun run test:e2e`         |
| coverage baselines or a package's exported API | `bun run test:coverage`    |
| dependencies                                   | `bun run outdated`         |

Use `bun run lint:fix` and `bun run format:fix` to apply mechanical fixes, then
re-run the checks. If you changed dependencies, follow AGENTS.md: update with
`bun update`, commit `bun.lock` separately, and make sure `bun run outdated`
passes.

Never make a check pass by weakening it. Do not add a new `eslint-disable`,
`@ts-expect-error`, or `as any` to silence a report, do not skip or delete a
failing test, and do not relax a tsconfig, ESLint rule, coverage baseline, or
CI job. Fix the cause. When a rule genuinely has to change, say so in the pull
request and follow `AGENTS.md`.

A failure that comes only from code already on the base branch is not yours to
fix here: report it back with the failing check and the commit that caused it,
so the base branch is repaired before the stack continues.

### Close the gap in CI

The gate above only helps if CI actually runs it. Before calling the change
verified, ask whether CI would catch a regression in the code you touched. If
the area has no relevant lint, type, or static check, add the missing check as
part of this fix rather than leaving the gap for the next person:

- Enable the ESLint rule or config that covers the pattern, instead of fixing
  one file by hand and letting the next file regress.
- Make sure the package's `typecheck` script compiles the new file and that CI
  still runs it.
- Add a unit or contract test when the rule exists only in prose, such as prompt
  contracts, schema parity, or migration invariants; CI's test job then enforces
  it.
- Add a `bun run` script to `package.json` and a step that calls it in
  `.github/workflows/ci.yml`, so the local command and CI cannot drift apart.
- For a new sidecar or tool, follow the `check:garmin` pattern: one script that
  runs every check, called by both the developer and CI.

Run the new check locally and make it pass. A check that nobody runs locally,
or that CI does not call, does not count. If the new check exposes failures
outside this issue's scope, do not fix them here: open a new issue for them and
narrow the check to the area this fix touches. Add the check next to whatever
earlier fixes in the stack added to the same workflow, and say in the pull
request body that CI coverage was extended.

List the checks you ran, including the issue-specific ones and any check you
added, in the pull request body so the reviewer can see the gate the fix passed.

## 8. Keep the documents current

Update `AGENTS.md` and the affected `docs/specs/*.md` whenever behavior,
prompts, routes, schema, or workflow changes. Do not describe the project as
open source or touch the licence notice.

## 9. Commit and open the pull request

```sh
git add <only the files you changed>
git commit -m "<focused message>"
git push -u origin fix/<number>-<short-slug>
gh pr create --base <base-branch> --head fix/<number>-<short-slug>
```

Stage files explicitly. Never use `git add -A` or `git commit -a`: unrelated
files that were already in the working tree must stay uncommitted and out of
the pull request. Before committing, re-run `git status --short` and confirm
every staged file belongs to the fix.

Target the base branch, not `main`. That keeps the pull request diff to this
issue alone even though the branch carries the earlier fixes underneath. Write
the body to include:

- `Closes #<number>` and a short summary of the fix.
- The checks you ran, naming the issue-specific static checks as well as the
  default four.
- A **Stacked pull request** line naming the pull request this one is based on
  (the previous one in the stack, or `main` for the first), its position in the
  merge order, and a reminder that it must be merged after the pull request
  beneath it.

Then watch CI and fix anything it reports:

```sh
gh pr checks --watch
```

Do not close the issue by hand; merging the pull request closes it. Do not
rebase or retarget the earlier pull requests in the stack; if GitHub retargets
this one to `main` after the pull request beneath it merges, that is expected.

## 10. Report back

Reply with the issue number and title, the branch, the base branch, a one-line
summary of the change, the checks you ran (including the issue-specific static
checks), and the pull request URL. If you stopped without a pull request, say
exactly where you stopped and why.
