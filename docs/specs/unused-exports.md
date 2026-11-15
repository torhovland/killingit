# Spec: Unused-export check

- **Status:** Accepted (implemented)
- **Date:** 2026-11-11
- **Related:** `docs/specs/test-coverage.md`, `AGENTS.md`.

## Goal

Keep production code honest about what it exports. An export that is only
referenced by its own unit test looks used while adding no production value, so
it should be deleted (or wired to a real caller) instead of being kept alive by
the test. The same holds for a shared helper that is only reachable through the
`@killingit/shared` barrel and never imported by a consumer.

## Scope

### In scope

1. A `knip` run in production mode over the API, web app, shared package, root
   scripts and the benchmark workspace.
2. Test files are excluded from the run, so an export that only a test imports
   is reported as unused.
3. The shared package's barrel (`packages/shared/src/index.ts`) is an entry, and
   its entry exports are checked (`includeEntryExports`). A symbol that every
   shared module re-exports wholesale is therefore reported when no production
   module outside the shared package imports it.
4. An export referenced only inside its own module (`ignoreExportsUsedInFile` is
   off). The helper is used in that module, so the fix is to drop the `export`
   keyword, not to delete the helper.
5. A CI job that fails when a new unused export or unreachable production file
   appears.

### Out of scope

- Checking for unused dependencies or unused files in test-only folders.

## Acceptance criteria

1. `bun run check:unused` passes on a clean tree.
2. The run fails when a production export is referenced only inside its own
   module, when it is referenced only by its test, when it has no reference at
   all, when a shared barrel export has no production consumer outside
   `packages/shared`, or when a production source file is unreachable from every
   entry point.
3. The API, web app, shared package, root scripts and the benchmark workspace
   are analysed; test, integration and e2e files are not treated as production
   consumers.
4. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   still pass.

## Configuration

`knip.json` lists each workspace's entry and project globs. The trailing `!`
marks a pattern as production code for `knip --production`; the check keeps
every non-test entry, including build scripts and the prompt benchmark, so only
unit tests are excluded as consumers.

`packages/shared` sets `includeEntryExports`. Its entry is the `export *` barrel,
so without that option every shared symbol counts as used merely by being
re-exported. With it, the barrel's exports are checked like any other entry's,
and a shared helper with no consumer in the API, the web app, the benchmark or
the scripts is reported — which is how `isRunningActivity`, `formatSport` and
`formatDailyWeatherLine` were found and deleted.

An export that is used only inside its own module needs no `export` keyword:
drop it. When a test imports that helper, the test is rewritten against the
production consumer that uses it; for example `bestFitSlope` in
`packages/shared/src/metrics.ts` is tested through `interpolateMetricSeries`.
The same applies to a constant or schema that composes a larger production
value: test the composed value instead of keeping the internal piece public.
A test that needs to inspect every fragment of a module, such as the shared
prompt-fragment guard, reads the module's source rather than importing internals
that production does not use.

If a genuinely public export has no in-repo consumer yet, add it to
`ignoreIssues` with a comment explaining why it is part of the public surface.

## CI

The `Unused exports` job in `.github/workflows/ci.yml` runs
`bun run check:unused` after installing dependencies from `bun.lock`. A failure
blocks merge just like typecheck, lint, format and tests.
