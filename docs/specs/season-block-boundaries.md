# Spec: Season block boundaries are validated on every write

- **Status:** Accepted (implemented)
- **Date:** 2026-11-01
- **Related:** `docs/specs/season-regeneration.md`,
  `docs/specs/coach-plan-prompts.md`, `docs/specs/coach-plan-lifecycle.md`.

## Goal

Keep the stored season's blocks tiling the season: every block starts the day
after the previous block ends. A response that shares a day between two blocks
or skips a day between them must never be saved, on any generation path.

## Background

A season refresh re-plans the season from today, so its result was checked for
contiguity. A week, day or block update echoes the whole season back, and that
copy was saved without any boundary check. A model that returned overlapping
blocks was therefore accepted by an update, stored, and sent back as "the
current season" in every later prompt. The next season refresh then reproduced
the overlap and failed with "The coach returned a season refresh with a gap
between blocks" — a message that names neither the blocks nor the dates, and
describes an overlap as a gap.

Test environment, 2026-11-01: blocks 1 and 2 both claimed 2026-11-23 (and every
later boundary shared its day), the plan was saved, and every "Update season
plan" failed afterwards.

## Scope

### In scope

1. One contiguity check, applied by the shared plan validation every write path
   runs: a full build, a season refresh, and a block, week, day, tomorrow,
   next-week or next-block update that returns the season.
2. Distinct, actionable errors for an overlap and for a gap, naming both blocks
   and the shared or unplanned date.
3. The rule in the prompts that return season blocks: the season plan prompt and
   the plan update prompt share one `SEASON_BLOCK_RULES` fragment.

### Out of scope

- Re-planning or normalising a stored plan that is already broken. A broken
  stored season fails the next write with the message below; the athlete
  recovers by planning a new season.
- Block boundaries that ended before today. Those blocks are stored history the
  coach cannot change, so they are not re-validated (see "Behaviour").
- Week dates inside a block, and season start/end coverage, which
  `assertRefreshedSeason` already checks for a refresh.

## Behaviour

### Check

From the first season block that has not yet ended (`endDate >= today`), each
block must start exactly one day after the previous block ends:

- `next.startDate <= previous.endDate` — the blocks overlap and the shared days
  belong to two blocks:
  `The coach returned overlapping season blocks: "<next>" starts on <date>, the
day "<previous>" ends. Please regenerate the plan.`
- `next.startDate > previous.endDate + 1` — the day after `previous` ends is not
  planned:
  `The coach returned a gap between season blocks: "<previous>" ends on <date>
and "<next>" starts on <date>, leaving <date> unplanned. Please regenerate
the plan.`

Blocks are compared in the order the response returns them; an unordered season
therefore fails as a gap or overlap at the boundary where the order breaks.

Blocks that already ended are history: the refresh restores them from the stored
plan, so a boundary between two past blocks cannot be fixed by the coach and is
not checked. Because the check runs on the plan that is about to be saved, a
boundary the coach controls can never be stored broken.

### Prompts

`SEASON_BLOCK_RULES` in `apps/api/src/llm/promptRules.ts` states the rule and a
worked example (a block ending 2026-11-23 is followed by one starting
2026-11-24), and is composed into `SEASON_PLAN_SYSTEM_PROMPT` and
`PLAN_UPDATE_SYSTEM_PROMPT`, replacing the prose each prompt used to carry.

## Data model and API impact

None. The check happens before the plan is saved; a rejected response leaves the
stored plan untouched and the run is marked failed as today.

## Acceptance criteria

1. A full build whose season blocks overlap is rejected and nothing is saved.
2. A week, day or block update that echoes overlapping season blocks is rejected
   and nothing is saved.
3. A season refresh with a gap is rejected with the dates that are unplanned.
4. A season refresh with an overlap is rejected with the shared date.
5. Blocks that ended before today do not fail a write.
6. Both prompts state the rule and neither keeps its own copy of it.
7. `bun run typecheck`, `bun run lint`, `bun run format` and `bun run test`
   pass.
