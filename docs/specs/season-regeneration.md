# Spec: Start a new season or update the existing one

- **Status:** Accepted (implemented)
- **Date:** 2026-10-26
- **Related:** `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/coach-plan-prompts.md`, ADR 0011.

## Goal

Let the athlete choose what a regeneration means. Starting a new season plans a
fresh, shorter season from today. Updating the existing season keeps the blocks
that are already in the past, refreshes the partially completed current block in
place, and re-plans the future blocks from there.

## Scope

### In scope

1. Replace the single "Regenerate plan" action on the coaching survey and
   settings pages with two explicit actions:
   - **Plan a new season** always builds a fresh season starting today.
   - **Update season plan** refreshes the remaining part of the stored season
     and is only shown when a season exists and today falls inside it.
2. Add an explicit generation mode to `POST /api/coaching/plan/generate`:
   - `auto` (default) keeps the lazy update behaviour, except that stale
     answers refresh an existing season instead of silently starting a new one.
   - `newSeason` forces a full four-level build from today.
   - `updateSeason` refreshes the existing season in place.
3. An update refreshes the partially completed current block with the latest
   athlete profile, activities, reviews, and coaching inputs while keeping its
   stored start date. Season blocks that ended before today are kept exactly as
   stored, and the future blocks are re-planned from the current block's end.
   The season start date is kept so the stored history stays in the same season.
4. The detailed block, week, and day are rebuilt for the refreshed current
   block, then today (and tomorrow after 18:00) as in a normal full build.
5. Generation progress reports a distinct season-refresh step.

### Out of scope

- Keeping a detailed week-by-week history for completed blocks.
- Moving a partially completed block to a new start date. Its start date is
  preserved.
- Plan history/versioning. A refresh overwrites the previous stored plan.

## Acceptance criteria

1. With no stored plan, only **Plan a new season** is offered; pressing it
   builds a full season starting today.
2. With a stored plan that covers today, both buttons are offered. **Update
   season plan** re-plans the remainder of the season from today; **Plan a new
   season** starts over from today.
3. An update keeps every season block whose end date is before today byte for
   byte (name, focus, dates, week count) and keeps the original season start
   date.
4. An update refreshes the partially completed current block in place: the
   current season block and the detailed block keep their stored start date.
   The following blocks cover the rest of the season without gaps. A response
   that moves the current block's start date fails with a readable error and
   leaves the old plan in place.
5. Saving changed answers with an existing season starts an update, not a new
   season. If there is no season, or today is outside it, saving answers falls
   back to a full new season.
6. `updateSeason` with no usable season falls back to a full new season.
7. `Plan a new season` builds exactly as the old forced regeneration did,
   including the activity review pass.
8. All four quality gates pass.

## API

`POST /api/coaching/plan/generate` accepts:

```json
{
  "today": "YYYY-MM-DD",
  "timezone": "Europe/Oslo",
  "mode": "auto | newSeason | updateSeason",
  "force": false,
  "includeTomorrow": false
}
```

`mode` defaults to `auto`. `force: true` remains supported for the benchmark
and means the same as `newSeason`.

## Generation flow

1. Promote a stored next period for today before deciding what to do.
2. Choose the path:
   - no plan, `force`, or `newSeason` → full build from a new season;
   - `updateSeason` (or `auto` with stale answers) and today inside the stored
     season → full build from a refreshed season;
   - `updateSeason` without a usable season → full build from a new season;
   - otherwise → the single day/week/block plan update.
3. A refreshed season uses the single plan-update prompt. It receives the
   existing season, block, week and day and returns the remaining season, the
   detailed current block, the revised week and today (plus tomorrow and the
   next period when wanted). The API then restores the stored completed block
   summaries and the original season start date, and checks that the current
   block keeps its stored start date before accepting the result.
4. The returned week and day are validated together with the refreshed block.
   A response that moves the current block's start date is rejected.
5. Save with the current answer, coaching-input, and activity timestamps.

## UI

- The coaching survey and settings pages show the two actions with a one-line
  explanation of the difference.
- Button availability is read from `GET /api/coaching/plan`; the update action
  appears only when the returned plan has a season containing today.
- "Update season plan" is the primary button whenever it is shown, since it is
  the safer action. "Plan a new season" is primary only when it is the only
  action offered; alongside the update action it is the secondary button.
- Progress continues to use the shared header status. The action being run
  shows a spinner and the coach label ("Coach is thinking…"); the other action
  is disabled until the run finishes.

## Testing

- Shared schema tests for `mode`, its default, and invalid values.
- Prompt tests for the season-refresh prompt and its required date rules.
- API unit tests for:
  - new-season mode when a plan exists;
  - update mode keeping completed blocks and the current block's start date;
  - automatic stale-answer refresh;
  - update fallback with no plan or an ended season;
  - rejecting a refreshed season or weekly revision that moves the current
    block's start date.
- Web render tests for both actions, including hiding the update action when no
  season exists, which action is primary, and the spinner and coach label on the
  running action.
- Run `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`.
