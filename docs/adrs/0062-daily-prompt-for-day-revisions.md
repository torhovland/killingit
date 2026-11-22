# ADR 0062: Use the daily prompt for a day-only plan revision

- **Status:** Accepted
- **Date:** 2026-11-22
- **Deciders:** torhovland
- **Related:** ADR 0013 (update every affected level in one completion),
  `docs/specs/daily-plan-refresh.md`, `docs/specs/coach-plan-prompts.md`,
  `docs/specs/plan-revision-steps.md`,
  `docs/specs/plan-refresh-judgement.md`

## Context

ADR 0013 routed every revision that was not a new season through one
plan-update prompt that returned the complete plan, and the API kept only the
levels the revision named. That is still right when a block, season or next
period changes: the coach needs the whole plan to keep those levels coherent.

For a refresh that changes only today and the week around it, however, the
complete response is mostly discarded. Production calls in November 2026 were
overwhelmingly day and tomorrow refreshes, at roughly 31k input and 6k output
tokens each, while the daily prompt that already builds a week's first day uses
about half the input and output because it returns only today, tomorrow and the
week. The plan-change scope added in #656 made the day-only revision explicit,
so it can be routed without guessing.

## Decision

- A revision whose flags change only the day, the week around it and tomorrow
  uses `generateDailyUpdate`. That is the case with `day` set and no `season`,
  `block`, `nextBlock` or `nextWeek` change.
- A week-only revision, a pure tomorrow fill, a progress-only diet refresh and
  every season, block or next-period revision keep the full plan-update prompt.
  The daily prompt cannot return season or block training content, a stored
  today that must stand in a week-only revision, or the next period.
- The daily response is merged through the same level helpers as a full update.
  Its today, week, tomorrow, diet and body metrics are applied; the stored
  season, block, next week and next block remain because the daily response
  does not carry them.
- A day refresh supplies the stored detailed today plan to the daily prompt, so
  a completion note or a revised prescription starts from what the athlete was
  asked to do. A first build supplies no day and renders the prompt as before.
- The daily prompt refreshes only the week's diet-progress target. Season and
  block targets wait for the next update that returns those levels, either a
  progress-only update when a target is missing or the next block or season
  update. This is documented rather than patched with a second compact call.

## Alternatives considered

- **Keep the full plan-update prompt for every revision.** Simple and already
  coherent, but it pays for season and block content that a day refresh always
  discards, and production shows that this is almost every refresh.
- **Ask the full prompt for only the changed levels.** It would shrink the
  response but break the one-contract design of ADR 0013 and its repair
  validation, and the daily prompt already exists for exactly this shape.
- **Return a compact season/block diet-progress patch from the daily prompt.**
  It saves a later progress update but adds a second response contract and a
  merge path for two fields. The deferral is simpler and the existing pending
  check already schedules a progress-only update.

## Consequences

- A day or tomorrow refresh runs the smaller daily prompt and saves its today,
  week and tomorrow. A block, season, next-period, week-only, tomorrow-only or
  progress-only revision still runs the full plan-update prompt.
- The prompt log records `daily_update` for the routed refresh instead of
  `plan_update`, so the two paths remain distinguishable in the log.
- Season and block diet-progress targets are not refreshed by a day-only
  revision. A missing target still makes the plan pending, so the next visit
  runs the progress-only update; a stale but present target waits for the next
  block or season update.
- The full prompt remains the only contract that can return the season, block
  and next period, so ADR 0013's level coherence for those revisions is
  unchanged.
