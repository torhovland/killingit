# ADR 0054: One tsconfig project per TypeScript tree

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** `docs/specs/typescript-project-coverage.md`, issue #334

## Context

The repository had no root `tsconfig.json`, and the root `typecheck` script was
`bun run --filter '*' typecheck`, which runs only the four workspace packages.
`scripts/**` — the outdated-dependency check, the sign-off check, the coverage
runner and their tests — belonged to no project, so roughly 1,200 lines were
never compiled. `eslint.config.js` covered for that by applying
`tsconfigs.disableTypeChecked` to `scripts/**` and `benchmarks/**`: the files
were linted without the type-aware rules and no project had to exist.

The benchmark harness that used to justify the `benchmarks/**` half moved into
the `tools/benchmark` workspace (ADR 0032), which has its own `tsconfig.json`
and `typecheck` script. Only the root scripts gap remained.

## Decision

- Add a root `tsconfig.scripts.json` that extends `tsconfig.base.json` and
  includes `scripts/**/*.ts` and `scripts/**/*.tsx`.
- Run it from the root `typecheck` script, ahead of the workspace filter, so
  the existing CI `Typecheck` job covers it without a new job.
- In `eslint.config.js`, parse `scripts/**` against `tsconfig.scripts.json`
  (`parserOptions.project`) instead of switching type-checked rules off, and
  delete the `benchmarks/**` entry.
- Guard the arrangement with `scripts/typescriptProjects.test.ts`: every
  TypeScript file outside the workspace packages must be selected by
  `tsconfig.scripts.json`, the root `typecheck` script must run that project,
  and every workspace must keep a `tsconfig.json` and a `typecheck` script.
- Install the root compiler as the alias `typescript7`
  (`npm:typescript@^7.0.2`). `typescript-eslint` supports the 6.x API only and
  aborts when it resolves 7.x, so a plain root `typescript@7` dependency breaks
  `bun run lint`, while a root `typescript@6` dependency makes
  `bun run outdated` fail against the published 7.x release. The alias gives
  the scripts project the pinned 7.x `tsc` and keeps the `typescript` specifier
  resolving to the 6.x copy ESLint needs.

## Alternatives considered

- **A root solution-style `tsconfig.json` with project references and
  `tsc -b`.** It would duplicate the per-workspace `typecheck` scripts, still
  need a compiler at the root, and change how every workspace is checked for a
  gap that only `scripts/` has. Rejected.
- **Making `scripts/` a workspace package.** It would give the folder its own
  compiler, but it also adds a workspace manifest that the API Dockerfile has
  to copy, moves the knip entry, and runs the scripts tests twice through the
  workspace filter — for a directory that is development tooling, not a
  package. Rejected.
- **Type-checking `scripts/` with `bun check`.** It needs no dependency, but it
  would be the only tree in the repo checked by a different engine, and its
  version would float with the Bun install instead of being pinned in
  `bun.lock`. Rejected.
- **Declaring a root `typescript@6` dependency.** It satisfies
  `typescript-eslint`, but `bun run outdated` then reports the deliberate pin
  as an outdated dependency on every run of the outdated check. Rejected.
- **Keeping the `disableTypeChecked` override and only adding the tsconfig.**
  The types would compile, but the strongest lint rules would still be off for
  exactly the code that had just been made checkable. Rejected.

## Consequences

- `bun run typecheck` compiles every TypeScript file in the repository, and a
  type error in `scripts/` fails CI.
- Type-aware `typescript-eslint` rules now apply to `scripts/**`. A floating
  promise in a script is reported now; the old configuration could not see it.
- A new root-level TypeScript tree fails `scripts/typescriptProjects.test.ts`
  until it is added to `tsconfig.scripts.json`, so the gap cannot silently
  reopen.
- The root `typescript7` alias is a temporary consequence of
  `typescript-eslint` not yet supporting the 7.x compiler; it can become a
  plain `typescript` dependency when that support lands.
