# Spec: TypeScript project coverage

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** `docs/adrs/0054-one-tsconfig-per-typescript-tree.md`,
  `docs/specs/accessibility-lint.md`, `docs/specs/unused-exports.md`,
  `AGENTS.md`.

## Goal

Every TypeScript module in the repository is checked by exactly one named
`tsconfig` project, and `bun run typecheck` fails when any of them does not
compile. Type-aware `typescript-eslint` rules apply to the same trees, so a
config file cannot quietly exempt a folder from the stronger lint rules.

## Scope

### In scope

1. The workspace packages — `apps/api`, `apps/web`, `packages/shared` and
   `tools/benchmark` — keep their own `tsconfig.json` and `typecheck` script.
   The root `typecheck` script already runs all four through
   `bun run --filter '*' typecheck`.
2. A root `tsconfig.scripts.json` extends `tsconfig.base.json` with `noEmit`
   and the Bun types, and includes `scripts/**/*.ts` and `scripts/**/*.tsx`.
   `scripts/` is not a workspace package, so nothing compiled it before.
3. The root `typecheck` script runs the scripts project before the workspace
   filter: `tsc -p tsconfig.scripts.json && bun run --filter '*' typecheck`.
   CI's existing `Typecheck` job calls that script, so no new job is needed.
4. `eslint.config.js` no longer disables type-checked rules for `scripts/**`;
   the files are parsed against `tsconfig.scripts.json`, and keep the Node
   globals they use. The `benchmarks/**` exemption is deleted, because the
   benchmark harness moved to the `tools/benchmark` workspace and `benchmarks/`
   holds no TypeScript.
5. A guard test (`scripts/typescriptProjects.test.ts`) fails when a TypeScript
   file outside the workspace packages is not selected by
   `tsconfig.scripts.json`, when the project is empty, when the root
   `typecheck` script stops running it, or when a workspace loses its
   `tsconfig.json` or `typecheck` script.

### Out of scope

- Checking JavaScript, JSON or YAML files with `tsc`.
- Replacing the per-workspace typecheck scripts with one solution-style root
  `tsconfig.json` and `tsc -b`.
- Adding a database migration or changing any API or UI behaviour.

## Acceptance criteria

1. `bun run typecheck` fails on a type error in any `scripts/*.ts` file and
   still fails on one in a workspace package.
2. `bun run lint` fails on a type-aware finding in `scripts/**` (for example a
   floating promise) and does not need a new `eslint-disable` or
   `@ts-expect-error`.
3. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test` and
   `bun run check:unused` pass on a clean tree.
4. A new root-level TypeScript file outside the workspace packages fails the
   guard test until it is included by `tsconfig.scripts.json`.

## Root compiler dependency

The workspaces install `typescript@7`, but `typescript-eslint` 8.x only supports
the 6.x compiler API (`>=4.8.4 <6.1.0`) and aborts when it resolves a 7.x
`typescript` from the root. The root therefore declares the compiler under the
alias `typescript7` (`npm:typescript@^7.0.2`), which installs the `tsc` binary
the scripts project runs while leaving the `typescript` specifier free to
resolve to the 6.x copy that ESLint needs. `bun run outdated` still tracks the
alias, so the compiler is kept current like every other dependency.

## Data model and API impact

None. The change only affects static checks, the development tooling and the
documentation of them.
