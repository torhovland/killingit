# Spec: Function size limits

- **Status:** Accepted (implemented)
- **Date:** 2026-11-20
- **Related:** ADR 0061, issue #572, `docs/specs/plan-run-arguments.md`,
  `AGENTS.md`.

## Goal

Stop a function from growing into an unreviewable block. Three ESLint rules
bound the shape of every function — how long it is, how much it branches and how
many positional arguments it takes — so the next oversized handler fails the
build instead of waiting for a later refactor.

The limits are a ratchet: they catch today's worst offenders, every offender is
fixed rather than suppressed, and the numbers tighten as the tree shrinks.

## Scope

### In scope

1. `max-lines-per-function` at **200** lines, `complexity` at **30** and
   `max-params` at **5** for every TypeScript file.
2. Fixing every non-test function above those numbers. At the time of writing
   that is six functions over 200 lines, four over complexity 30 and five with
   six parameters.
3. Excluding test files and the two end-to-end fixture trees (`apps/api/e2e`,
   `apps/web/e2e`): a test may lay out a long arrange/act/assert block without
   the production split rules.
4. The tree-wide `max-params` limit replaces the four-file limit that
   `docs/specs/plan-run-arguments.md` added, so a sixth argument now fails
   everywhere, not only at the plan entry points.

### Out of scope

- **The benchmark harness.** `tools/benchmark/**` keeps its current situation:
  it is a local comparison tool with deliberately long prompt and report
  stages, and it is not shipped. It is exempt until it becomes production code;
  the exemption is recorded here rather than in a suppression baseline so the
  rest of the tree cannot hide behind it.
- Reaching the eventual 70-line / 12-complexity / 5-parameter target in one
  step. That would mean refactoring about 190 functions at once; the ratchet
  below is the path.
- Suppression baselines. No `eslint-suppressions.json` is added and no
  `eslint-disable` is used for these rules.

## Thresholds and the ratchet

The numbers are the tail of the measured distribution, not a guess:

| Rule                     | Limit | Violations above it | Next step |
| ------------------------ | ----: | ------------------: | --------: |
| `max-lines-per-function` |   200 |                   6 |       150 |
| `complexity`             |    30 |                   4 |        25 |
| `max-params`             |     5 |                   5 |         5 |

Counts exclude tests, the end-to-end fixtures and `tools/benchmark`. The next
step is measured with the same command once this lands; tighten one rule at a
time and fix what it catches rather than lowering all three at once.

## Acceptance criteria

1. `bun run lint` passes with the three rules enabled.
2. A new function of 201 lines, of complexity 31, or with six parameters fails
   `bun run lint`, so CI catches the regression.
3. Every violation the rules reported when they were introduced is fixed; no
   suppression is added.
4. The benchmark harness is exempt and its existing code is unchanged.
5. `bun run typecheck`, `bun run format` and `bun run test` still pass.

## Data-model and API impact

None. The change is lint configuration, refactoring and documentation.
