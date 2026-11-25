# ADR 0064: Plan a season from a goal ledger instead of one goal at a time

- **Status:** Accepted
- **Date:** 2026-11-25
- **Deciders:** torhovland
- **Related:** `docs/specs/goal-ledger.md`,
  `docs/specs/athlete-events.md`, `docs/specs/coach-plan-prompts.md`,
  `docs/specs/season-simulation.md`, `docs/specs/llm-benchmark.md`

## Context

The season prompt described blocks by a focus and a date range. The athlete
events were supplied as context, and a post-hoc goal-feasibility rule asked the
coach to judge the level it was planning. Nothing required a block to account
for a goal later in the season. Models therefore planned the next goal until its
date and only then started the next goal, leaving too little time for the later
one. Weaker models did this most often.

The coach also had no structured way to record what a block was doing for each
goal. Prose in `focus` was easy to rewrite on a refresh, and there was no
validation that every goal was covered. Tests were allowed as workouts but the
prompts never mentioned them.

## Decision

- The season plan carries a `goals` list with each dated goal's title, date,
  target and priority. All goals default to `A`; the coach may rank one lower
  when the athlete's own words or the coaching situation justify it.
- Every season block summary and detailed block plan carries `subGoals`. A
  sub-goal names the goal, the block's role (`build`, `maintain` or
  `accept-decline`), a measurable target and the date by which it should be
  reached. A block may have several sub-goals for one goal.
- Every block that starts before a goal's date must account for that goal.
  Recovery and taper blocks still account for goals still ahead, normally by
  maintaining or accepting a decline. A block after every goal has an empty
  sub-goal list.
- The prompt tells the coach to work backwards from every goal: what the goal
  needs, how long the specific preparation takes, and what must be maintained
  during an earlier goal's block. Sub-goals are coaching judgements, not an
  arithmetic spread of a season total.
- The fields stay optional in stored plans so older plans still parse. Generated
  season and block answers require them and are repaired when they are missing.
  Stored plans that already carry goals are checked before a save.
- Tests remain ordinary workouts. A shared rule encourages the coach to use them
  when they answer a question the plan depends on, embedded in a productive
  session rather than added as an extra day.
- The existing goal-steering benchmark fixture, validator and judge are updated
  to carry and assess the ledger; no new season-start benchmark is added.

## Alternatives considered

- **Prose only, no structured fields.** Cheapest, but weak models can omit a
  future goal and the app cannot notice. A refresh can also lose the reasoning.
- **A full goal and test entity with database tables.** More product surface
  than the planning problem needs, and tests would stop being ordinary workouts.
- **One sub-goal per goal per block with a fixed formula.** Rejected because
  meaningful milestones depend on the sport, the athlete and the training
  science; the coach must define them.

## Consequences

- Season plans grow by a small structured ledger, and block plans repeat their
  summary's sub-goals. The formatters include both in every plan prompt.
- A missing goal or sub-goal is a repairable schema error instead of a silent
  planning omission.
- The goal-steering benchmark measures whether a model revises the ledger and
  raises a target, not only whether it produces a bigger week.
- The season simulation records a test workout at the athlete's modelled current
  performance, so the coach sees the expected test result in the activity
  analysis.
