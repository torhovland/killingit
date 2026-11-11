# Spec: Unused-export check

- **Status:** Accepted (implemented)
- **Date:** 2026-11-11
- **Related:** `docs/specs/test-coverage.md`, `AGENTS.md`.

## Goal

Keep production code honest about what it exports. An export that is only
referenced by its own unit test looks used while adding no production value, so
it should be deleted (or wired to a real caller) instead of being kept alive by
the test.

## Scope

### In scope

1. A `knip` run in production mode over the API, web app, shared package, root
   scripts and the prompt-benchmark scripts.
2. Test files are excluded from the run, so an export that only a test imports
   is reported as unused.
3. An export used inside its own module is not reported: the export keyword may
   be unnecessary, but the code is still live.
4. A CI job that fails when a new unused export or unreachable production file
   appears.

### Out of scope

- Checking for unused dependencies or unused files in test-only folders.
- Enforcing that every internal helper is un-exported when its module uses it.

## Acceptance criteria

1. `bun run check:unused` passes on a clean tree.
2. The run fails when a production export is referenced only by its test, when
   an export has no reference at all, or when a production source file is
   unreachable from every entry point.
3. The API, web app, shared package, root scripts and prompt-benchmark scripts
   are analysed; test, integration and e2e files are not treated as production
   consumers.
4. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   still pass.

## Configuration

`knip.json` lists each workspace's entry and project globs. The trailing `!`
marks a pattern as production code for `knip --production`; the check keeps
every non-test entry, including build scripts and the prompt benchmark, so only
unit tests are excluded as consumers.

`ignoreExportsUsedInFile` keeps internal-only helpers out of the report. If a
genuinely public export has no in-repo consumer yet, add it to `ignoreIssues`
with a comment explaining why it is part of the public surface.

## CI

The `Unused exports` job in `.github/workflows/ci.yml` runs
`bun run check:unused` after installing dependencies from `bun.lock`. A failure
blocks merge just like typecheck, lint, format and tests.
