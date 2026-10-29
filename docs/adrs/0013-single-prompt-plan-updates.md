# ADR 0013: Update every affected plan level in one completion

- **Status:** Accepted
- **Date:** 2026-10-29
- **Deciders:** torhovland
- **Related:** `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/coach-plan-prompts.md`,
  `docs/specs/season-regeneration.md`, ADR 0009 (next period), ADR 0011
  (new season versus update)

## Context

The lazy cascade used one completion per level: a block change called the block
prompt, then the weekly prompt, then the daily prompt. Each later prompt saw the
result of the previous one, and the same level could be revised more than once.
The model that revised the block did not see the week or today it was making
incoherent, so the next prompt had to repair the damage. A week and day change
needed two completions, and a block change needed three. The same was true for a
season refresh, which asked for the season and block and then rebuilt the week
and day separately.

The athlete only ever has one current plan. Every update therefore has all of
the current levels available, and the coach can make a better decision when it
sees the season, block, week, today, tomorrow and the next period together.

## Decision

- Add one plan-update prompt that receives every current level: season, block,
  week, today, tomorrow, next week and next block.
- The prompt also receives a revision request naming the levels that must change
  and the dates they must use. It returns the complete plan, keeping the levels
  that were not requested exactly as supplied.
- The API applies only the levels named in the revision request. A block
  revision applies the returned block, week and day; a week or day revision
  applies the returned week and day; a next-period revision applies the returned
  next week, next block and tomorrow. Unrequested levels are ignored.
- Use the same prompt for the lazy day/week/block update, the next-period update
  after 18:00, and a season refresh. A new season still builds the season,
  first block, week and day in separate steps because there is no stored plan
  to update.
- The update response is the full `CoachPlan` shape, so the coach can keep every
  level coherent and the API has one contract to validate and repair.

## Alternatives considered

- **Keep the cascade but add the missing levels to each prompt.** Easier, but it
  still costs up to three completions and lets each call rewrite the previous
  call's work.
- **Ask for only the changed levels.** Smaller responses, but the model cannot
  show a coherent week and day with the revised block, which is the problem this
  change fixes.
- **Let the model decide which levels changed and apply all of them.** Removes
  app-side control and could rewrite the current block or season on every
  activity update. The API knows what is stale, so it keeps that decision.

## Consequences

- An update costs one completion instead of up to three. A season refresh also
  drops from three completions to one.
- The response is larger because it carries every level, but a current plan is
  still small compared with the 16,384-token output budget.
- The update prompt is longer and shares the weather, load, bike-workout,
  optionality, rationale and outline rules with the build prompts through
  `promptRules.ts`.
- The app validates the returned week dates, next-period dates, today's date and
  tomorrow's placement before saving. A response that moves a required block
  start date or leaves tomorrow outside a planned week fails with the existing
  readable error and leaves the old plan in place.
- The prompt log gains the `plan_update` kind. Historical `daily_update`,
  `weekly_update`, `block_update`, `target_day_update` and `season_refresh`
  rows remain readable.
