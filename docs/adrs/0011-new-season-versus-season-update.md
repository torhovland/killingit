# ADR 0011: Separate new-season planning from season updates

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** torhovland
- **Related:** `docs/specs/season-regeneration.md`,
  `docs/specs/coach-plan-lifecycle.md`

## Context

Every full rebuild used the same prompt: plan a season starting today. That is
right for a new athlete or a deliberate fresh start, but wrong in the middle of
a season. Saving updated survey answers, or pressing the single "Regenerate
plan" button, silently replaced the whole season with a shorter one starting
today and discarded the completed part of the season.

The athlete needs to choose between starting over and refreshing what remains.
The automatic stale-answer path also needs a safe default so a routine profile
edit does not throw away the season.

## Decision

- Add a generation `mode` to `POST /api/coaching/plan/generate`:
  `auto` (default), `newSeason`, and `updateSeason`.
- `newSeason` is the old forced rebuild: a fresh season starting today, its
  first block, the current week, and today.
- `updateSeason` re-plans the existing season from today. One completion asks
  for the remaining season and the detailed block that starts today. The API
  restores every stored block that ended before today, keeps the original
  season start date, and validates that the remaining blocks start today and
  cover the rest of the season.
- `auto` keeps the lazy cascade. When saved answers make the plan stale, it
  uses `updateSeason` if today is inside the stored season; otherwise it falls
  back to a new season.
- The survey and settings pages expose both actions explicitly. The update
  action is shown only when `GET /api/coaching/plan` returns a season that
  contains today.

## Alternatives considered

- **One button with a confirmation dialog.** Fewer controls, but it hides the
  consequence of the choice. Two named actions make the difference visible.
- **Always update, never start a new season.** Safer for the common case, but
  leaves no way to deliberately reboot a plan after a major goal change.
- **Ask the coach whether to keep the season.** An extra model call and
  non-deterministic; this is the athlete's decision.

## Consequences

- A stale-answer regeneration costs three completions (season refresh, week,
  day) instead of four (season, block, week, day).
- The previous current block is replaced by a block starting today. Its past
  weeks are not retained as a detailed history; only completed block summaries
  are kept.
- The season refresh can still revise the season goal and end date from the
  latest answers, but it cannot move the season start date or rewrite completed
  blocks.
- `force: true` remains for the benchmark and behaves like `newSeason`.
