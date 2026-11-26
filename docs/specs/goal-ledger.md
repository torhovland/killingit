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
   priority (`A`, `B` or `C`). A goal stated only as a month or year is included
   with the middle day of that period as its planning anchor and the athlete's
   words in `dateText`.
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
   each goal, the block sub-goal coverage, week planning that names the block
   sub-goals it advances, a derived goal-demand estimate, and a load audit. Every
   plan prompt gets the goal-ledger and goal-demand rules; the weekly, daily and
   update prompts also get the week-to-block rule.
7. **Goal demand.** The coach states the performance a goal needs in its own
   units, the current estimate, the gap and the assumptions, using a prior
   result on the same or a similar course as the anchor. A stated threshold from
   the period of the prior result is enough to anchor it; the coach may not
   refuse because a separate race power was not recorded. A `build` sub-goal
   states the numeric goal-required target, not an interim milestone, and the
   block's weekly `estimatedFtpWatts` must progress toward it. A goal to
   complete a stated distance has a concrete finish-time or pace target even
   when the athlete stated no time; that target is derived from the distance,
   the event standard and the athlete's demonstrated endurance.
8. **Load audit.** The coach compares the week's planned hours with the stated
   capacity, sums the sessions' TSS against the target load, states CTL and the
   projected TSB, and treats "completed every session, felt easy" as evidence
   that the stored load was too low. An 8-10 hour build week is normally about
   350-500 TSS, not 300-340.
9. Tests are ordinary productive workouts, not a first-class session type. The
   coach is encouraged to use them when necessary, but the prompt does not force
   a test at a fixed time. A test replaces the hard stimulus of a workout rather
   than adding another session.
10. The goal-steering benchmark carries the structured ledger in its stored plan
    and validates a response that keeps, revises or adds the required fields.
    The judge uses the athlete's prior 3:20 at about 285 W as the anchor: 3:10
    needs at least 280 W, and the harness model's 281 W is a floor, not a
    comfortable target. It rewards a revised block that accounts for the goals
    and a build sub-goal at or above that floor.
11. The season simulation treats a session that prescribes a test as a test: the
    recorded activity is completed at the performance the athlete's model
    expects on that date, and its analysis states the test result.

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
  /** The athlete's wording when only a month or year is known. */
  dateText?: string | null;
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
- every sub-goal references a goal in `season.goals` by its date; the title is a
  display label and may include the date;
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

- `GOAL_LEDGER_RULES` describes the goal list, priorities, month/year planning
  anchors and `dateText`, the season headline, backward planning, block
  coverage, recovery and taper accounting, and the rule that sub-goals are
  coach-defined rather than interpolated.
- `GOAL_DEMAND_RULES` makes the coach derive the goal's required power, pace or
  time from the input, anchor it to a prior comparable result, and state the
  current gap. It requires a numeric build target and a weekly FTP/pace
  progression toward it.
- `LOAD_AUDIT_RULES` makes the coach reconcile planned hours with stated
  capacity and session TSS with the week target load, state CTL/TSB, and treat
  positive "felt easy" feedback as under-load.
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
judge rubric uses the athlete's own prior 3:20 at about 285 W as the anchor:
3:10 needs at least 280 W, and the harness model's 281 W is a floor, not a
comfortable target. It rewards raising the build sub-goal to at least that floor,
showing the weekly FTP progression, keeping a future goal accounted for, and
adding a productive test when it helps. The full-season
simulation detects a test in a session title or description and records that
activity at the athlete's modelled FTP or threshold pace, with the test result in
the analysis.

## Acceptance criteria

1. A season answer without `goals`, or with a current or future block without
   `subGoals`, is rejected and repaired.
2. A block answer without `subGoals`, or with a sub-goal whose date does not
   reference a stored season goal, is rejected and repaired.
3. Every block that starts before a goal date carries at least one sub-goal for
   that goal; recovery and taper blocks account for it explicitly.
4. The prompt requires dated goals in date order, priorities, backward planning
   and block sub-goals built from coaching judgement. A month/year goal is
   included with `dateText` and a middle-day planning anchor.
5. The season `goal` headline summarises the season's goals and shape; it need
   not list every goal when there are many, but it must not imply a single-goal
   season.
6. The weekly, daily and update prompts require the week focus to name the block
   sub-goals it advances.
7. The coach derives the goal-required performance from the input and states the
   current gap; a stated threshold from the prior-result period is enough to
   anchor it. A `build` sub-goal carries the numeric required target and the
   weekly FTP estimate reaches it. A distance-only goal carries a concrete
   completion time or pace and the longest training ride needed.
8. The load audit reconciles planned hours and session TSS, and treats completed
   easy sessions as evidence of under-load.
9. A past race or goal remains in the prompt context, marked `past`; a past trip
   does not.
10. The goal-steering benchmark fixture and validator carry the structured fields,
    and the judge rubric expects at least 280 W from the prior 285 W anchor.
11. The season simulation records a test workout at the modelled current
    performance and states the result in the activity analysis.
12. Typecheck, lint, format, unused-export check and tests pass.

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
