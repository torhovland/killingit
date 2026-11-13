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
   scripts and the prompt-benchmark scripts.
2. Test files are excluded from the run, so an export that only a test imports
   is reported as unused.
3. The shared package's barrel (`packages/shared/src/index.ts`) is an entry, and
   its entry exports are checked (`includeEntryExports`). A symbol that every
   shared module re-exports wholesale is therefore reported when no production
   module outside the shared package imports it.
4. A CI job that fails when a new unused export or unreachable production file
   appears.

### Out of scope

- Checking for unused dependencies or unused files in test-only folders.
- Enforcing that every internal helper is un-exported when its module uses it
  (`ignoreExportsUsedInFile`, see "Known gap" below).

## Acceptance criteria

1. `bun run check:unused` passes on a clean tree.
2. The run fails when a production export is referenced only by its test, when
   an export has no reference at all, when a shared barrel export has no
   production consumer outside `packages/shared`, or when a production source
   file is unreachable from every entry point.
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

`packages/shared` sets `includeEntryExports`. Its entry is the `export *` barrel,
so without that option every shared symbol counts as used merely by being
re-exported. With it, the barrel's exports are checked like any other entry's,
and a shared helper with no consumer in the API, the web app, the benchmark or
the scripts is reported — which is how `isRunningActivity`, `formatSport` and
`formatDailyWeatherLine` were found and deleted.

An internal helper that is exported but used only inside its own module is
handled by hand rather than by the check. `bestFitSlope` in
`packages/shared/src/metrics.ts` was un-exported this way, with its dedicated
test rewritten against `interpolateMetricSeries`, the production consumer that
uses it.

If a genuinely public export has no in-repo consumer yet, add it to
`ignoreIssues` with a comment explaining why it is part of the public surface.

## Known gap

`ignoreExportsUsedInFile` is still enabled, because turning it off reports
roughly 220 exports across the API, web app, shared package and benchmark that
are referenced only from within their own module (many of them only by tests).
Closing that gap is a follow-up of its own, tracked in issue #365: every finding
is either an unnecessary `export` keyword or an export kept alive by its test,
and several call for restructuring the test that imports it. Until then the
reusable rule still stands on its own: do not leave an export alive only for a
test, and un-export an internal helper by hand.

## CI

The `Unused exports` job in `.github/workflows/ci.yml` runs
`bun run check:unused` after installing dependencies from `bun.lock`. A failure
blocks merge just like typecheck, lint, format and tests.
