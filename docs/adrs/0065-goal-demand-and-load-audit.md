# ADR 0065: Make goal demand and load arithmetic explicit

- **Status:** Accepted
- **Date:** 2026-11-25
- **Deciders:** torhovland
- **Related:** `docs/specs/goal-ledger.md`,
  `docs/specs/llm-benchmark.md`, `docs/specs/athlete-events.md`, ADR 0064

## Context

The goal ledger made the coach list goals and block sub-goals, but the
goal-steering benchmark still kept a 252 W sub-goal for a 3:10 gravel race. The
coach had the athlete's prior 3:20 at about 285 W FTP, the current 247 W, 8-10
hours of stated capacity and a weekly note saying every session felt easy. It
still did not derive the roughly 280 W the goal needs, did not use the stated
capacity, and did not make its sessions add up to its own target load. Telling
the model not to be timid does not fix that: the prompt never required the
arithmetic, and the stored target load was treated as a baseline.

## Decision

- Add `GOAL_DEMAND_RULES`. The coach states the performance a goal needs in its
  own units, the current estimate, the gap and the assumptions. It uses a prior
  comparable result as the anchor, and a stated threshold from the period of
  that result is enough when no separate race power was recorded. A `build`
  sub-goal carries the numeric goal-required target, and the block's weekly FTP
  or pace estimates must progress toward it.
- Add `LOAD_AUDIT_RULES`. The coach sums planned hours against stated capacity,
  sums session TSS against the week target, states CTL and the projected TSB,
  and treats "completed every session, felt easy" as evidence that the stored
  load was too low. An 8-10 hour build week is expected to be roughly 350-500
  TSS.
- Keep past races and goals in the prompt context, marked `past`. A past goal
  explains the season's history; a past trip remains out of context.
- The goal-steering judge uses the athlete's prior 3:20 at about 285 W as the
  honest anchor. The harness model's 281 W is a floor, not a comfortable target;
  a build sub-goal below 280 W is not a plan for 3:10.

## Alternatives considered

- **Another "be ambitious" instruction.** It does not force a number or a load
  calculation, so a weak model can keep writing plausible prose.
- **Give the coach the benchmark's course model.** Rejected: that is the judge's
  hidden ground truth, not input the athlete supplied. The coach must derive the
  demand from the prior result and stated thresholds.
- **Make every target a hard app-calculated number.** Too rigid for a coach and
  would replace judgement; the prompt rules and judge keep the reasoning with
  the coach.

## Consequences

- The coach must show its demand estimate and load arithmetic, making a timid
  plan visible.
- A build sub-goal and the weekly FTP projection must agree.
- The goal-steering benchmark now rewards a sub-goal of at least 280 W, anchored
  to the prior 285 W; an interim 252 W milestone no longer passes.
- The final `openai/gpt-6-luna-pro` goal-steering response plans a 285 W build
  sub-goal and a 285 W week-7 FTP estimate.
