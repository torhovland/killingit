# ADR 0063: Ask the plan-update prompt only for the levels a revision changes

- **Status:** Accepted
- **Date:** 2026-11-22
- **Deciders:** torhovland
- **Related:** ADR 0013 (update every affected level in one completion), ADR 0062
  (daily prompt for day-only revisions), `docs/specs/coach-plan-prompts.md`,
  `docs/specs/plan-revision-steps.md`, `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/daily-plan-refresh.md`

## Context

ADR 0013 gave every non-day revision one plan-update prompt that returned the
complete plan, and the API kept only the levels the revision named. The saved
plan still needs every level as input so the coach can keep a revised block,
week and day coherent, but the response does not: a week-only revision never
uses the returned season or block training content, and a block-in-place
revision never uses an unrequested next week or next block.

Production measurements from 2026-10-28 to 2026-11-22 (178 initial plan
updates) were mostly day and week scopes. A day-scoped response averaged about
22k characters and 5.4k output tokens, of which the season and block were
discarded by the merge. ADR 0062 removed the highest-volume case by routing a
day-only revision to the daily prompt. The remaining week, block, next-period
and progress-only revisions still re-emitted levels the merge discarded.

## Decision

- Build the plan-update response contract from the revision:
  - a week-only revision returns the week;
  - a day revision that stays on this prompt returns the week and today;
  - a block revision returns the season, block, week and today;
  - a next-block revision returns the season and next block (plus any week and
    tomorrow its flags request);
  - a next-week or tomorrow revision returns only the week or next week the
    tomorrow session needs, plus tomorrow;
  - every response also returns `diet`, `bodyMetrics` and the coach notes.
- A season refresh keeps the complete contract. It re-plans the whole plan from
  the current block, so every level is in play, and the benchmark prompt that
  measures a season revision stays the same.
- A progress-only revision (all training flags clear and `progress` set) returns
  every level that carries a `dietProgress` target: the season, the block, the
  week, the next week and the next block. It changes only those targets.
- The prompt still receives every stored level as context, so the coach can keep
  a returned level coherent with the stored ones it does not return.
- The response schema requires the levels the revision asks for and accepts the
  others as optional. An omitted level keeps its stored content. The merge
  helpers take a partial response and fall back to the stored level.
- The diet-progress checks cover only the levels the response carries. A stored
  level outside the contract is neither required to have a target nor judged for
  consistency, because the response cannot change it.
- The repair hint names only the dates and levels the contract asks for.

## Alternatives considered

- **Keep the complete contract for every revision.** Simple and already
  coherent, but it pays for season and block content that week, block and
  progress revisions always discard.
- **Ask for only the changed levels without a partial merge.** Smaller still, but
  the merge and its validation assume a complete plan. A deliberate
  fill-from-stored step keeps the existing level rules single-purpose.
- **Use separate prompts per level.** More contracts to keep in parity and more
  completions, which is the cascade ADR 0013 replaced.

## Consequences

- Week and block responses drop the unrequested levels, and the progress-only
  response keeps every level whose target it refreshes.
- The plan-update schema becomes a partial response; `applyPlanUpdate` and the
  level merges fall back to the stored level for every omitted field.
- A season revision's prompt and the benchmark snapshot are unchanged.
- The prompt contract, the Zod schema and the diet-progress check read the same
  level selection, so a new level or target cannot be requested by one and
  ignored by another.
