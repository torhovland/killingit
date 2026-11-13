# Spec: Pure revision flags and per-level plan merges

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/plan-finalisation.md`, `docs/specs/plan-run-arguments.md`,
  ADR 0011, ADR 0013.

## Goal

Make the rules that decide which plan levels an update revises, and the rules
that merge each level back into the stored plan, testable on their own instead
of only through a complete generation run.

## Background

`apps/api/src/plans/generate.ts` derived every revision flag inline in
`advancePlan`, and `applyPlanUpdate` merged the coach's answer into the stored
plan as a run of about fifteen sequential `plan = { ...plan, ... }`
reassignments. That made the most important behaviour of a plan update — which
levels change and which stored levels survive — visible only to a test that
runs the whole pipeline with a fake provider and in-memory stores.

## Scope

### In scope

1. `revisionFlags(input)` in `apps/api/src/plans/revision.ts`, a pure function
   that returns the `PlanUpdateFlags` for one run from the stored plan, the
   pending flags, the run's revision decision, today's date and whether the run
   wants tomorrow.
2. `mergeSeasonAndBlock`, `mergeWeekAndDay`, `mergeNextPeriod` and
   `mergeTomorrow`, which apply one level group each to the stored plan. They
   are pure apart from rejecting a malformed answer: a refreshed season that
   moves the current block, and a tomorrow outside a planned week, still throw
   the same errors.
3. Direct unit tests for every flag rule and every merge rule.

### Out of scope

- Behaviour. `runPlanGeneration` saves the same plan for the same input; the
  prompt, the stored plan shape, the database and the API contract are
  unchanged.
- Splitting `generate.ts` into separate modules. The request, generation and
  save steps stay where they are.
- The diet-progress, diet and body-metric merges, which are not level merges.

## The revision rules

| Flag              | Set when                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `season`          | The run is a refresh rather than an advance.                                                                                                   |
| `block`           | A refresh, a pending block, or a week review while today is inside the stored block.                                                           |
| `week`            | The block changed, new input needs a revision, the week or day is pending, or a next-block revision lands in the current week.                 |
| `day`             | The block changed, new input needs a revision, or the week or day is pending. It is deliberately false for a next-block revision in this week. |
| `tomorrow`        | The run wants tomorrow and tomorrow, the week, the day, the next block or the next week changed.                                               |
| `nextWeek`        | The run wants tomorrow and tomorrow starts a new week.                                                                                         |
| `nextBlock`       | The run wants tomorrow, the next block is pending, and no block revision already covers it.                                                    |
| `clearNextPeriod` | A refresh, block revision, input revision, pending week or next-block revision makes the stored next period stale.                             |
| `blockInPlace`    | A week review arrived while today is still inside the stored block, so that block is revised in place.                                         |
| `progress`        | Always. A plan update refreshes the diet progress targets too.                                                                                 |

## The merge rules

`applyPlanUpdate` composes the helpers in a fixed order:

1. `mergeSeasonAndBlock` restores the greeting on every returned season. A
   refresh also keeps the completed blocks and the original season start date,
   takes the returned block, and rejects an answer that moved the current
   block's start date. A block revision takes the returned block; a next-block
   revision refreshes only the season summary.
2. The block's expected start date is checked against the returned block. A
   week review that lands inside the block passes `reviseBlock`, so the coach
   revises the current block in place instead of starting the next one.
3. `mergeWeekAndDay` takes the returned week and today for a day revision, and
   the returned week with the stored today for a week-only revision.
4. `mergeNextPeriod` clears the stored next block and next week that a full
   revision did not return, then stores the returned ones.
5. `mergeTomorrow` clears or stores tomorrow, drops it when it is no longer the
   next day, and copies tomorrow's outline from the returned week or next week.
6. The week-only revision restores today's stored session, then the diet
   progress targets, diet and body-metric points are merged.

## Target structure

- A pure flag function owns the revision rules, so a table test can pin them.
- Each level group owns its merge, so a direct test can show which stored
  levels survive an update.
- `advancePlan` keeps the request, today preservation and finalisation, and
  `applyPlanUpdate` reads as an ordered composition instead of a long list of
  spread assignments.

## Data model and API impact

None. No schema, route, prompt or stored plan field changes.

## Acceptance criteria

1. `revisionFlags` is a pure function in
   `apps/api/src/plans/revision.ts` and `advancePlan` calls it instead of
   deriving the flags inline.
2. Season, block, week, day, next-period and tomorrow merges each live in a
   named helper with a direct unit test.
3. `runPlanGeneration` behaves exactly as before; every existing test passes.
4. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`,
   `bun run check:unused` and `bun run test:coverage` pass.
