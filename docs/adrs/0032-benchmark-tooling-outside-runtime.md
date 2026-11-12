# ADR 0032: Benchmark tooling lives outside the runtime API package

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** torhovland
- **Related:** `docs/specs/llm-benchmark.md`,
  `docs/specs/llm-model-catalog.md`, `docs/specs/test-coverage.md`, issue #170

## Context

The LLM benchmark harness lived in the production API package:

- `apps/api/src/benchmark/` held the coach benchmark CLI, runner, fixtures and
  report. Nothing in the server imported it.
- `apps/api/src/llm/promptBenchmark.ts` held the model-catalog benchmark
  definition and scoring, imported only by `benchmarks/prompts/*.ts`.
- `apps/api/src/llm/modelCatalog.ts` mixed runtime catalog maintenance (refresh,
  price grades, discouraged flag) with benchmark-only queries and grade writes.

The Docker image already excluded the unreferenced files, so shipping size was
not the problem. The cost was the developer loop and the readability of the API
package: benchmark and grading changes were typechecked, linted and tested as
server code, and a reader could not tell runtime from tooling. The root
`benchmarks/` directory is plain scripts, so it is neither typechecked nor
tested in CI, which made it a poor home for code that decides model grades.

## Decision

- Add a workspace `tools/benchmark` (`@killingit/benchmark`) for benchmark
  tooling. It is typechecked and tested by the existing `bun run typecheck` and
  `bun run test` workspace filters, and its suite is measured by a coverage
  group in `scripts/coverage.ts`.
- Move the coach benchmark CLI, config, fixtures, runner, report and types
  there unchanged. `bun run benchmark:llm` now runs
  `tools/benchmark/src/cli.ts` from the repository root.
- Move `promptBenchmark.ts` there too, since nothing in the server imports it,
  and move the benchmark-only catalog queries and grade writes into
  `tools/benchmark/src/catalogBenchmark.ts`.
- Keep the runtime catalog in `apps/api/src/llm/modelCatalog.ts`: refresh,
  list-price and benchmark-derived grades, alias copying, usability checks and
  the catalog rows the API serves. The server still grades a model from a
  benchmark result, because the catalog is refreshed in the background.
- Keep `benchmarks/prompts/` as the data directory. Its run and report
  directories stay git-ignored there, while the root run scripts that used to
  live beside them moved into `tools/benchmark/src/promptBenchmark*` (the
  superseded heuristic scorer was dropped). The stages now call the app's
  `LlmProvider` and prompt builders, share one CLI entry
  (`bun run benchmark:prompts <stage>`), and are typechecked, linted and covered
  like the plan comparison.

## Alternatives considered

- **Leave the code in `apps/api/src`.** Rejected: it is the problem the issue
  describes, and it keeps inviting runtime code to depend on benchmark code.
- **Move everything into `benchmarks/` as plain scripts.** Rejected: the root
  scripts workspace is not typechecked, and the benchmark policy decides model
  grades, so it must stay covered by types, tests and lint.
- **One workspace per benchmark suite.** Rejected: the coach benchmark reports
  plan quality while the catalog benchmark grades models, but both are
  developer tooling with the same dependencies and the same home. A single
  package keeps one `typecheck`/`test` entry and one coverage floor.
- **Add export subpaths to `apps/api` for the runtime pieces.** Rejected: it
  would grow the application's public surface for a tool that lives in the same
  repository. The tool imports the source paths directly, exactly as
  `benchmarks/prompts/` already does.

## Consequences

- `apps/api/src` contains only code reachable from the server, plus the shared
  prompts and catalog helpers the server really uses.
- Benchmark changes still get types, lint and tests, because the workspace runs
  in the same CI gates.
- The moved modules import `apps/api` by relative source path. That coupling is
  deliberate: the benchmark must exercise the real plan-generation pipeline, not
  a copy of it.
- `benchmarks/prompts/` keeps only its data directories. The former root
  scripts were outside every tsconfig, so their types were never checked; moving
  them into the workspace closed that gap and replaced their private fetch
  client with the app's `LlmProvider`.
