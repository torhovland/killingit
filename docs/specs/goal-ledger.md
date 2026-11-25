# Spec: Goal ledger and block sub-goals

- **Status:** Accepted (implemented)
- **Date:** 2026-11-25
- **Related:** `docs/specs/athlete-events.md`,
  `docs/specs/coach-plan-prompts.md`, `docs/specs/season-simulation.md`,
  `docs/specs/llm-benchmark.md`, ADR 0064.

## Goal

Stop a coach from planning a season as a sequence of unrelated goals: build only
for the next goal until its date, then start preparing for the following one.
Every season plan carries a goal ledger, and every block states what it does for
every dated goal still ahead. A week then plans toward its block's sub-goals, and
the coach may use tests as productive workouts when a test answers a question
the plan depends on.

## Scope

### In scope

1. A season plan carries `goals`: every dated race, goal or other dated target
   the athlete stated, in date order, each with a title, date, target and
   priority (`A`, `B` or `C`).
2. Every season block summary and detailed block plan carries `subGoals`. A
   sub-goal names the goal it serves, the block's role for that goal (`build`,
   `maintain` or `accept-decline`), a coach-defined measurable target, and the
   date inside the block by which the target should be reached. A block may
   carry several sub-goals for one goal.
3. Every block that starts on or before a goal's date must account for that goal
   with at least one sub-goal. A block with no goal still ahead carries an empty
   `subGoals` array. Recovery and taper blocks still account for every future
   goal, usually as `maintain` or `accept-decline`.
4. Goal priority is the coach's judgement: all goals are `A` unless the athlete
   says otherwise or the coach has a reason to rank one lower. Even when every
   goal is `A`, the coach may focus on the next goal and accept a decline for a
   later one, provided the remaining time is enough to train for the later goal.
5. Sub-goals are defined by the coach from training science. They are not a
   mathematical interpolation of a season total or an even weekly spread.
6. The shared prompt rules require the goal ledger, the backward planning from
   each goal, the block sub-goal coverage, and week planning that names the block
   sub-goals it advances. Every plan prompt gets the goal-ledger rules; the
   weekly, daily and update prompts also get the week-to-block rule.
7. Tests are ordinary productive workouts, not a first-class session type. The
   coach is encouraged to use them when necessary, but the prompt does not force
   a test at a fixed time. A test replaces the hard stimulus of a workout rather
   than adding another session.
8. The goal-steering benchmark carries the structured ledger in its stored plan
   and validates a response that keeps, revises or adds the required fields. The
   judge rewards a revised block that accounts for the goals and penalises
   ignoring a future goal.
9. The season simulation treats a session that prescribes a test as a test: the
   recorded activity is completed at the performance the athlete's model expects
   on that date, and its analysis states the test result.

### Out of scope

- A separate test session type, test result model or automatic threshold write.
  Tests remain workouts whose title and description carry the protocol.
- An app-side feasibility formula or automatic sub-goal interpolation. The
  coach is the only planner.
- Hand editing a goal or sub-goal in the web app.
- A new benchmark prompt at the start of a multi-goal season. The existing
  goal-steering prompt is updated instead.

## Data model

Shared (`packages/shared/src/plan.ts`):

```ts
type GoalPriority = "A" | "B" | "C";

interface SeasonGoal {
  title: string;
  date: string;
  priority: GoalPriority;
  target: string;
}

type BlockSubGoalRole = "build" | "maintain" | "accept-decline";

interface BlockSubGoal {
  goalTitle: string;
  goalDate: string;
  role: BlockSubGoalRole;
  target: string;
  byDate: string;
}
```

`SeasonPlan.goals`, `SeasonBlockSummary.subGoals` and `BlockPlan.subGoals` stay
optional in the stored schema so a plan saved before this change still parses.
The generated answer schemas require them: a season answer must carry `goals`
and a `subGoals` array on every current or future block, and a block answer must
carry `subGoals`. A missing field is a schema validation error and gets the
normal repair turn.

## Validation

`apps/api/src/plans/goals.ts` owns the pure checks:

- each current or future block has a `subGoals` array;
- every upcoming `race`, `goal` or `event` has a matching date in
  `season.goals`; trips remain constraints and are not goals;
- every sub-goal references a goal in `season.goals` by title and date;
- every goal still ahead at a block's start is covered by at least one sub-goal
  in that block;
- a sub-goal's `byDate` falls inside its block;
- the detailed block's sub-goals match its season block summary.

The generation schemas run the checks as refinements and repair a bad answer.
`assertPlanValid` also runs them on a stored plan that already carries `goals`,
so a merge cannot save a plan that lost its ledger. Plans saved before the field
existed are not retrofitted and do not fail.

## Prompt rules

`apps/api/src/llm/promptRules.ts` owns the shared fragments:

- `GOAL_LEDGER_RULES` describes the goal list, priorities, backward planning,
  block coverage, recovery and taper accounting, and the rule that sub-goals are
  coach-defined rather than interpolated.
- `WEEK_BLOCK_GOAL_RULES` requires a week's focus and rationale to name the block
  sub-goals it advances and every session to serve one or recovery.
- `TESTING_RULES` describes tests as productive workouts: use them when they
  answer a question the plan depends on, embed them in the hard stimulus of the
  day, and do not add them on top of a hard week.

The formatters render the season goal ledger and a block's sub-goals into every
prompt, including the update prompts, so a refresh sees the stored ledger.

## Benchmark and simulation

The goal-steering fixture stores the two 2027 goals and the gravel block's
sub-goals. The prompt therefore shows the ledger the coach must revise. The
response validator requires the goal and sub-goal fields, and the judge rubric
rewards raising the targets toward the at-risk goal, keeping a future goal
accounted for, and adding a productive test when it helps. The full-season
simulation detects a test in a session title or description and records that
activity at the athlete's modelled FTP or threshold pace, with the test result in
the analysis.

## Acceptance criteria

1. A season answer without `goals`, or with a current or future block without
   `subGoals`, is rejected and repaired.
2. A block answer without `subGoals`, or with a sub-goal that does not reference a
   stored season goal, is rejected and repaired.
3. Every block that starts before a goal date carries at least one sub-goal for
   that goal; recovery and taper blocks account for it explicitly.
4. The prompt requires dated goals in date order, priorities, backward planning
   and block sub-goals built from coaching judgement.
5. The weekly, daily and update prompts require the week focus to name the block
   sub-goals it advances.
6. The goal-steering benchmark fixture and validator carry the structured fields,
   and the judge rubric considers them.
7. The season simulation records a test workout at the modelled current
   performance and states the result in the activity analysis.
8. Typecheck, lint, format, unused-export check and tests pass.

## Testing

- Shared schema tests for the goal and sub-goal fields, their optionality in
  stored plans and the enums.
- API unit tests for coverage, missing fields, mismatched block summaries and
  repair-triggering schema answers.
- Prompt tests for `GOAL_LEDGER_RULES`, `WEEK_BLOCK_GOAL_RULES`,
  `TESTING_RULES` and the rendered ledger.
- Benchmark tests for the new validation and the updated judge text.
- Simulation tests for test detection and the recorded result.
- Run `bun run typecheck`, `bun run lint`, `bun run format`,
  `bun run check:unused`, `bun run test` and `bun run check:garmin`.
