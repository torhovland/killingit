# Shared package barrel

## Goal

`packages/shared/src/index.ts` is the package's public surface. It was a
hand-maintained barrel listing every symbol from every module, which made it the
second most-changed file in the repository: each new shared symbol cost an edit
and invited a merge conflict. Re-export each module wholesale instead, so the
barrel only changes when a module is added.

## Scope

- `packages/shared/src/index.ts` re-exports every module with
  `export * from "./<module>.js"`. The health-check and greeting schemas stay
  declared there because they belong to no other module.
- A name must exist in exactly one module, because a symbol exported by two
  modules is ambiguous in a wildcard barrel and fails typechecking.
  `packages/shared/src/date.ts` owns `planDateSchema`; `plan.ts` no longer
  re-exports it, and every importer reads it from `date.js`.
- Symbols that a module used only internally are not exported:
  `POWER_WINDOW_SECONDS` and `averagePower` in `trainingLoad.ts` stay private,
  so the wildcard adds nothing to the public surface.
- `packages/shared/src/index.test.ts` imports a representative symbol from every
  module through the barrel, so a module that stops being re-exported fails the
  test.

## Acceptance criteria

- Adding an export to an existing shared module requires no `index.ts` edit.
- The public surface is unchanged: the barrel exports the same runtime names
  and types as before.
- `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test` and
  `bun run check:unused` pass.

## Data model and API impact

None. The barrel keeps every export's name, signature and type, so no schema,
route or prompt changes.
