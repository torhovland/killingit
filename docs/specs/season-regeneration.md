# Spec: Start a new season or update the existing one

- **Status:** Accepted (implemented)
- **Date:** 2026-10-26
- **Related:** `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/coach-plan-prompts.md`, ADR 0011.

## Goal

Let the athlete choose what a regeneration means. Starting a new season plans a
fresh, shorter season from today. Updating the existing season keeps the blocks
that are already in the past and re-plans the rest of the season from today.

## Scope

### In scope

1. Replace the single "Regenerate plan" action on the coaching survey and
   settings pages with two explicit actions:
   - **Plan a new season** always builds a fresh season starting today.
   - **Update season plan** refreshes the remaining part of the stored season
     and is only shown when a season exists and today falls inside it.
2. Add an explicit generation mode to `POST /api/coaching/plan/generate`:
   - `auto` (default) keeps the existing cascade behaviour, except that stale
     answers refresh an existing season instead of silently starting a new one.
   - `newSeason` forces a full four-level build from today.
   - `updateSeason` refreshes the existing season from today.
3. An update re-plans the current and future blocks from today with the latest
   athlete profile, activities, reviews, and coaching inputs. Season blocks
   that ended before today are kept exactly as stored. The season start date is
   kept so the stored history stays in the same season.
4. The detailed block, week, and day are rebuilt for the revised current block,
   then today (and tomorrow after 18:00) as in a normal full build.
5. Generation progress reports a distinct season-refresh step.

### Out of scope

- Preserving the previous current block when it started before today. It is
  replaced by a block that starts today.
- Keeping a detailed week-by-week history for completed blocks.
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
4. An update's first remaining block starts today, the remaining blocks cover
   the season without gaps, and the detailed current block starts today. A
   response that violates this fails with a readable error and leaves the old
   plan in place.
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
   - otherwise → the existing day/week/block cascade.
3. A refreshed season asks the coach for the remaining season and the detailed
   block starting today in one completion. The API then restores the stored
   completed block summaries and the original season start date before
   validating the result.
4. Build the week and the revised block, then today (and tomorrow after 18:00),
   using the same steps and validation as a full build.
5. Save with the current answer, coaching-input, and activity timestamps.

## UI

- The coaching survey and settings pages show the two actions with a one-line
  explanation of the difference.
- Button availability is read from `GET /api/coaching/plan`; the update action
  appears only when the returned plan has a season containing today.
- Progress continues to use the shared header status. The running button names
  the action being performed.

## Testing

- Shared schema tests for `mode`, its default, and invalid values.
- Prompt tests for the season-refresh prompt and its required date rules.
- API unit tests for:
  - new-season mode when a plan exists;
  - update mode keeping completed blocks and starting the remaining season
    today;
  - automatic stale-answer refresh;
  - update fallback with no plan or an ended season;
  - rejecting a refreshed season that does not start today.
- Web render tests for both actions, including hiding the update action when no
  season exists.
- Run `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`.
