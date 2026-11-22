# Spec: Daily prompt for a day-only plan refresh

- **Status:** Accepted (implemented)
- **Date:** 2026-11-22
- **Related:** `docs/specs/plan-revision-steps.md`,
  `docs/specs/plan-refresh-judgement.md`,
  `docs/specs/coach-plan-prompts.md`, ADR 0013, ADR 0062.

## Goal

Stop paying for a complete plan response when a refresh changes only today and
the week around it. A day-scoped comment, a missing or moved day and the
ordinary next-day advance use the daily prompt, whose contract already returns
today, tomorrow and the week, while every revision that reaches the season,
block or next period keeps the plan-update prompt. That prompt now asks only
for the levels the revision changes, so a week-only or progress-only refresh
does not re-emit season and block training content either. See ADR 0063.

## Scope

### In scope

1. Route a revision whose flags set `day` and no `season`, `block`, `nextBlock`
   or `nextWeek` through `generateDailyUpdate`.
2. Merge the daily response's today, week, tomorrow, diet and body metrics
   through the same level helpers as a full update. The stored season, block,
   next week and next block remain because the daily response has no such
   levels.
3. Supply the stored detailed today plan to the daily prompt when it belongs to
   today, so a refresh of a completed or already planned session starts from the
   prescription and completion note the athlete has.
4. Record a coach question from the daily response with the `daily_update`
   source kind and prompt kind.
5. Document the diet-progress deferral below.

### Out of scope

- Week-only revisions (`week` set, `day` clear), a pure tomorrow fill, the
  progress-only diet refresh in `freshPlan.ts`, and every season, block or
  next-period revision. They keep the plan-update prompt because they need
  levels the daily contract does not carry.
- Right-sizing the week, block and season prompts themselves; that is
  `docs/specs/plan-revision-steps.md` and ADR 0063.
- Changing the model or its reasoning budget.

## Revision routing

`planChangeScope` still decides how far an input reaches. `revisionFlags` turns
that scope and the pending levels into the same flags as before. The request
then chooses the prompt:

| Flags                                                       | Prompt       |
| ----------------------------------------------------------- | ------------ |
| `day`, with no `season`, `block`, `nextBlock` or `nextWeek` | daily update |
| `week` only, or a pure tomorrow fill                        | plan update  |
| progress only                                               | plan update  |
| `season`, `block` or a next-period revision                 | plan update  |

A day-only revision still sets `week` because today's outline in the week must
stay in step; it is the `day` flag and the absence of the wider levels that
choose the daily prompt. A day scope that also wants tomorrow stays on the
daily prompt; the response's tomorrow is merged when the `tomorrow` flag is
set.

The remaining revisions use the plan-update prompt, but its response contract
carries only the levels they change: a week-only refresh returns the week, a
block refresh returns the season, block, week and today, and a progress-only
refresh returns every level whose `dietProgress` target it refreshes. A season
refresh keeps the complete contract. See ADR 0063.

The merge uses the revision flags exactly as a full update does: a day revision
takes the returned today and week, a tomorrow revision takes the returned
tomorrow, and `clearNextPeriod` clears a stored next period the revision did not
return. Today's preserved-session path (`keepToday`) and finalisation are
unchanged.

## Diet-progress deferral

The daily response carries the week's `dietProgress` target, not the season or
block targets. A day-only refresh therefore refreshes the current week's target
(and finalisation copies it to the matching block-week summary), while the
season-end and block-end targets wait for the next update that returns those
levels: a progress-only update when a target is missing or inconsistent, or the
next block or season update. The targets are not copied from the week because
they are different periods with different destinations.

This is deliberate. A compact season/block progress patch would add a second
response contract and merge path for two fields, and a missing target already
makes the plan pending so the next visit runs the progress-only update.

## Data model and API impact

None. No database schema, migration, route or wire-contract change. The daily
prompt gains an optional `todayPlan` input used only when a refresh has a stored
day for today; a first build renders the prompt as before.

## Acceptance criteria

1. A day-scoped comment runs one daily-update completion, not the full
   plan-update prompt.
2. The response carries only today, tomorrow and the week; the stored season and
   block training content is kept.
3. Season and block diet-progress targets are documented as deferred to the
   next update that returns those levels.
4. Tests cover the day and tomorrow route, the merge, the preserved season and
   block, and the week-only, tomorrow-only and progress-only exceptions.
5. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test` and
   `bun run check:unused` pass.

## Testing

- `apps/api/src/plans/generation/revision.test.ts` starts from a day-scoped
  comment and asserts one `daily` call, the revised today and week, and the
  stored season, block and next period.
- The same file calls `requestPlanUpdate` with the day, day-plus-tomorrow,
  week-only, tomorrow-only and progress-only flags and asserts the prompt the
  provider receives.
- `apps/api/src/llm/planUpdatePrompt.test.ts` asserts the daily prompt renders
  the stored detailed today plan when one is supplied.
- The benchmark's daily prompt is a first build with no stored day, so its
  snapshot does not change.
