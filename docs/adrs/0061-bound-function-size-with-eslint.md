# ADR 0061: Bound function size, complexity and parameters with ESLint

- **Status:** Accepted
- **Date:** 2026-11-20
- **Deciders:** torhovland
- **Related:** `docs/specs/function-size-limits.md`, issue #572,
  `docs/specs/plan-run-arguments.md`

## Context

Nothing stopped a function from growing without limit. Measured at the time of
this decision, the tree had 131 functions over 70 lines, 87 over complexity 12
and 8 with six parameters, and the worst were 468 lines, complexity 39 and six
parameters. Reviewing such a function means holding a whole route, prompt or
chart in one head, and splitting it later competes with feature work.

The alternative to a limit is a suppression baseline: enable the rule, record
every current violation and let new code fail. With 226 entries that baseline
would be a second copy of the debt, one command away from growing, with no
owner per entry.

## Decision

Bound the three dimensions with ESLint, at the tail of the current
distribution: 200 lines, complexity 30 and 5 parameters. Fix every non-test
function above those numbers instead of suppressing it. Exempt the local
benchmark harness, which is not shipped. Treat the numbers as a ratchet: lower
them as the tree shrinks, one rule at a time.

## Consequences

- A new oversized or over-parameterised function fails `bun run lint`, so CI
  stops the next one at the point it is written.
- The fifteen functions above the limits are split or given an options object
  now, which is the part of the debt that hurts most in review.
- The limits are looser than the eventual 70-line / 12-complexity target. They
  are a first step, not a claim that a 190-line function is good.
- The benchmark harness stays as it is and must be brought in when it becomes
  production code.
