# Spec: Let the coach judge whether an input needs a plan refresh

- **Status:** Accepted (implemented)
- **Date:** 2026-11-12
- **Related:** `docs/specs/coach-feedback-and-program-review.md`,
  `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/coach-run-cancellation.md`, ADR 0029.

## Goal

Stop paying for a plan refresh when the coach has just read the athlete's input
and concluded the plan still fits. The analysis that already reads the workout,
comment, weekly note, manual activity or review comment decides whether a
refresh is needed; nothing extra is asked of the model.

## Scope

### In scope

1. **One flag, decided by the coach who read the input.** The structured
   activity analysis and every coach reply carry `planChangeNeeded`. The
   existing completion already sees the plan and the input, so the decision costs
   no extra call, tokens or thinking time.
2. **Context by default.** `planChangeNeeded` is false for an input that does
   not change what the coach would prescribe: a workout that matched its
   prescription, praise, a thank-you, a feeling the plan already accounts for, a
   question, or context about a past session. It is true when the input changes
   the remaining season, block, week, today or tomorrow: a new constraint or
   commitment, illness or injury, a recovery signal that should ease the load, a
   performance result that resets the targets, or a newly stated goal or event.
3. **The plan completion is skipped when the flag is false.** The run still
   loads the activity feed and the coaching inputs, reads the athlete's text
   when it changed, and settles today's completion and training load; it does
   not call the plan-update completion. The stored plan keeps its training
   content and records the inputs it has seen.

### Out of scope

- **A separate judgement prompt.** The model that wrote the analysis or the reply
  makes the call, so a refresh never costs a second completion.
- **Meals.** A logged meal stays prompt context only; it does not request a plan
  refresh. See `docs/specs/diet-log.md`.
- **A model of every input's history for display.** The flag is plumbing, not a
  new athlete-facing state.
- **Deferring a refresh the plan demonstrably needs.** A missing level, a new
  survey answer, a generated period review, a significant forecast change, a
  moved day, an explicit regeneration and a deleted activity keep refreshing the
  plan as before.

## Data model

- `activity_analyses.plan_change_needed` (boolean, not null, default false): the
  analysis's answer. Cached with the analysis, so a stored review is never
  re-billed to re-decide it.
- `coach_replies.plan_change_needed` (boolean, not null, default false): the
  reply's answer for its input. `target` is the activity id, week start date,
  manual activity id or review start date, so the loader can match each input to
  its reply.

No `coach_plans` column changes. The plan keeps storing the newest input and
analysis timestamps it has seen, which also records inputs whose flag was false.

## Prompt contracts

- `COACH_ANALYSIS_CONTRACT` gains `planChangeNeeded`.
- `COACH_REPLY_CONTRACT` becomes `{ "reply": string, "planChangeNeeded": boolean }`;
  the batched comment reply carries the same field per item.
- `PLAN_CHANGE_FLAG_RULES` in `promptRules.ts` owns the instruction for both
  prompts and explains the default.
- `REPLY_PLAN_CHANGE_RULES` in the same module puts the decision in the
  athlete's words: a reply says whether the input changes the plan and, if so,
  what the coach will adjust, and says the plan stands when it does not. The
  reply never promises an adjustment its own `planChangeNeeded` flag denies.
- A missing flag fails open. A reply or analysis that ignores the JSON contract,
  or omits the field, is treated as `true` so an unparsed answer can never
  silently drop a needed refresh.

## Refresh decision

The plan stores two kinds of timestamp:

- **All inputs**: the newest activity analysis and the newest coaching input, as
  before. Used by the athlete reading and to record what has been seen.
- **Refresh-worthy inputs**: the newest analysis or coaching input whose flag is
  `true` (or is unknown because no reply was generated, or the input is a deleted
  activity or a generated period review, which always refresh).

An input is new when its all-input timestamp is newer than the plan's stored
timestamp. A refresh is needed when a refresh-worthy timestamp is newer than the
plan's stored timestamp:

```
inputsChanged   = refreshInputsUpdatedAt  > plan.coachingInputsUpdatedAt
activitiesChanged = refreshActivitiesUpdatedAt > plan.activitiesUpdatedAt
```

`weekReviewPending` and `blockReviewPending` use the same flag: a generated review
always refreshes, a commented review follows its reply.

When there are new inputs but none asks for a refresh, the run is idle. It saves
the stored plan with the current all-input timestamps, and applies the local
parts of a refresh first: today's completion status, the completed days in the
week, and the training-load snapshot. That is what keeps the Today tab and the
fitness numbers correct after an ordinary workout even though no plan completion
runs. If nothing new has arrived and no promotion is due, nothing is written.

## API and UI

- `GET /api/coaching/plan` reports `stale` from the refresh-worthy coaching-input
  timestamp, so a no-change input does not make the dashboard start a run on
  every visit.
- `pending.block` follows the review flag, so a no-change comment on a completed
  week does not keep the block pending.
- The reply response shapes are unchanged; the flag stays server-side.
- The plan generation progress still runs for an activity analysis, but with no
  plan-update step, so it finishes quickly.

## Acceptance criteria

1. An activity analysis that returns `planChangeNeeded: false` does not run the
   plan-update completion; the stored plan keeps its training content and gains
   today's completion status and training load.
2. An activity analysis that returns `planChangeNeeded: true` refreshes the plan
   as before.
3. Saving an activity comment, weekly note, manual activity or review comment
   whose reply returns `planChangeNeeded: false` still stores and returns the
   reply and still runs the cheap preparation and athlete reading, but does not
   run the plan-update completion.
4. Saving an input whose reply returns `planChangeNeeded: true` starts the same
   run and revision it starts today.
5. A missing or unparsable flag is treated as `true`.
6. A stored analysis or reply keeps its flag; a cached analysis is not
   regenerated to re-decide it.
7. The batched comment run answers every comment first and stores each flag
   before the plan phase reads it.
8. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test` and
   `bun run check:unused` pass.
