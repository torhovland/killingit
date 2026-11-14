# Spec: Dependency freshness

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Issue:** #344
- **Related:** `.github/workflows/outdated.yml`, `scripts/check-outdated.ts`,
  `scripts/checkOutdated.test.ts`, `docs/specs/ci-build-job.md`, `AGENTS.md`.

## Goal

A pull request's result must depend on its own diff, not on the npm registry. A
dependency that publishes a release while a pull request is open used to fail
that pull request's `outdated` job, so an unrelated pull request went red for a
reason its author could not fix. Dependency freshness still has to be reported
loudly, so the check moves off the pull-request path instead of disappearing.

## Scope

### In scope

1. Remove the `outdated` job from `.github/workflows/ci.yml`. Every other CI
   job, including the `build` job, keeps its name, order and behaviour.
2. A separate `.github/workflows/outdated.yml` triggered by a daily `schedule`
   and by `workflow_dispatch`, with the same
   `permissions: contents: read` and the same
   `actions/checkout@v5` / `oven-sh/setup-bun@v2` /
   `bun install --frozen-lockfile` / `bun run outdated` shape as the jobs it
   replaces.
3. A failure signal the maintainer actually sees.
4. A parser in `scripts/check-outdated.ts` that fails loudly on output it does
   not understand, and a unit test that pins the real Bun output.
5. `AGENTS.md` rules 7 and 8, and this spec.

### Out of scope

- Automated dependency updates (Renovate, Dependabot, or `bun update` in CI).
  This change decides when the existing check runs, not how updates are made.
- Raising or lowering dependency versions. The scheduled run reports what is
  outdated; a human updates.
- A third-party action. The workflow uses only `actions/checkout` and
  `oven-sh/setup-bun`, like every other job.

## Behaviour

### Schedule

`outdated.yml` runs once a day at 06:17 UTC, and on demand through
`workflow_dispatch`. It runs against the default branch, which is where a
scheduled workflow runs and the tree whose dependencies are deployed.

Daily rather than weekly: a patch or security release should surface within a
day. The check costs a couple of minutes, and its failure is an email rather
than a blocked pull request, so there is no noise to trade against freshness.
The minute is deliberately off the hour, because GitHub delays or drops runs
scheduled at the start of an hour under load.

### Failure signal

An outdated dependency fails the `outdated` workflow's run:

- GitHub sends the failure notification to the user who last modified the cron
  schedule, the maintainer, which is the documented behaviour for scheduled
  workflows.
- The failed run is visible in the repository's Actions tab under the
  `outdated` workflow, with the outdated table in the job log.

That is the whole signal. Opening or updating an issue on failure was
considered and rejected: it needs `issues: write` on the workflow and
deduplication state for a repeated failure, and it tells the maintainer nothing
the failed scheduled run does not already tell them. No third-party action is
added anywhere.

In a public repository GitHub disables a scheduled workflow after 60 days
without repository activity. A commit that changes the cron expression
reactivates it and makes that committer the notification target, and
`workflow_dispatch` runs it by hand meanwhile.

### The check

`bun run outdated` runs `bun outdated -r`, which lists every workspace's
dependency that has a newer version available. Bun exits zero even when that
list is not empty, so the script is what turns a non-empty report into a failing
run.

Bun 1.4 offers no machine-readable output for `bun outdated`: its `--help` lists
no such flag, the `bun pm` commands that emit JSON (`licenses`, `diff`) report
installed packages rather than the registry's available versions, and the
lockfile carries only the installed versions. The human-readable table is
therefore the only interface, and the script reads it:

- `parseOutdatedOutput` strips ANSI colour, ignores blank lines, the
  `bun outdated vX.Y.Z (...)` banner and the table's separator rows, and reads
  the `Package`, `Current`, `Update`, `Latest` and, when present, `Workspace`
  columns.
- The banner alone is Bun's "nothing is outdated" output. A table with no rows,
  a missing required column, a row of the wrong width or any other text is
  reported as unrecognised, and the script exits non-zero with the raw output
  and a pointer to the parser. Silence is never read as success: a changed Bun
  layout fails the check instead of hiding an outdated dependency.
- `scripts/checkOutdated.test.ts` pins real `bun outdated` 1.4.4 output — a
  recursive table with entries, a single-project table, and the banner-only
  up-to-date output — so a format change fails a test rather than passing
  silently. `bun run test` runs that suite.

### Updating

`bun update` applies the `Update` column (the newest version the declared
semver range allows). A `Latest` difference is a major-version jump and needs
`bun update --latest` (or `bun update -i`). After either, verify typecheck,
lint, format and tests, and commit the regenerated `bun.lock` (and any
`package.json` changes) in a separate commit.

## Acceptance criteria

1. `ci.yml` has no `outdated` job, and no job in it runs `bun run outdated`;
   the `build` job and every other job keep their place.
2. `outdated.yml` triggers only on `schedule` and `workflow_dispatch`, requests
   `contents: read`, and runs the frozen install before `bun run outdated`.
3. No step in `outdated.yml` has `continue-on-error` or an `if` condition that
   could hide a failure.
4. `bun run outdated` exits `0` with "All dependencies are up to date." on a
   current tree, and exits `1` with the table on an outdated tree or on
   unrecognised output.
5. `scripts/checkOutdated.test.ts` and `scripts/ciWorkflow.test.ts` pass under
   `bun run test`, and the latter fails if the registry check is put back on
   the pull-request path.

## Data model and API impact

None. No application code, schema, route, migration or runtime dependency
changes; only the workflows, the development script and the documentation.
