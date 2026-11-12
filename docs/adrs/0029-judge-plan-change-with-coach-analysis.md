# ADR 0029: Let the coach analysis decide whether the plan needs a refresh

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** torhovland
- **Related:** `docs/specs/plan-refresh-judgement.md`,
  `docs/specs/coach-feedback-and-program-review.md`,
  `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/coach-run-cancellation.md`, ADR 0004 (OpenRouter), ADR 0014
  (latest-wins coach runs).

## Context

Every coach input cost a plan refresh. Saving a weekly note, commenting on a
workout, recording a manual activity or reviewing a completed week generated a
reply and then started the whole plan-update completion with its 16,384-token
output budget. A newly analysed activity did the same, including an ordinary
workout that matched the plan.

The coach had already read the input before the plan refresh: the activity
analysis sees the workout, the week and the block, and the reply sees the same
plan and training context. The judgement "does this change the plan?" belongs to
that read, not to a second completion that repeats the same context.

Most inputs are context: a workout that matched its prescription, praise, a
thank-you, or a comment that explains a session. Paying for a full plan update
after each of them is wasteful and adds tens of seconds of thinking time for a
plan that should not move.

## Decision

- The activity analysis returns `planChangeNeeded`. Every coach reply returns the
  same flag with its text, and the batched comment reply carries it per comment.
  The existing completion makes the decision, so there is no extra call, no
  extra prompt and no extra thinking time.
- The flag is deliberate coaching judgement, not obedience: false is the
  default for context, and true is set when the input changes what the coach
  would prescribe in the remaining season, block, week, today or tomorrow.
- The flag is stored with the analysis (`activity_analyses.plan_change_needed`)
  and the reply (`coach_replies.plan_change_needed`), so a cached analysis is
  never re-billed to re-decide it.
- An input whose reply says no change still runs the cheap preparation, the
  athlete reading and the day's completion, but the run skips the plan-update
  completion and saves the reconciled stored plan with the new timestamps.
- An activity analysis follows the same rule: the run still settles the day's
  completion and the training-load snapshot, but a no-change analysis does not
  call the plan-update prompt.
- A missing or unparsable flag is true, so a model that ignores the contract
  cannot silently drop a needed refresh. Deleting an activity, a generated
  period review, survey answers, a missing level, a significant forecast change
  and an explicit regeneration keep refreshing as before.

## Alternatives considered

- **A separate small judgement completion before every refresh.** It separates
  the decision from the analysis, but it pays a second completion whose input is
  almost the same as the analysis or reply that already read the input, and it
  adds latency to every input.
- **Always refresh as before, but make the plan update cheaper.** It does not
  remove the wasted completion for an ordinary workout or a thank-you, and it
  changes the plan quality for every input.
- **Keep the flag only in memory and never store it.** The routes could use the
  reply they just generated, but the batched comment run and the next dashboard
  visit need the judgement too, and a crashed run would forget it. Storing it
  costs one boolean per input.

## Consequences

- An ordinary workout, comment, note, manual activity or review comment costs no
  plan-update completion. The reply and analysis still cost what they did
  before; nothing is added to them except one boolean.
- The plan's `coaching_inputs_updated_at` and `activities_updated_at` keep
  recording every input, so a context-only input is not read again. Staleness
  and pending flags are computed from the refresh-worthy subset.
- A run for a new analysis still performs the cheap preparation, including the
  weather fetch, so today's completion and load are correct. It does not call
  the plan-update prompt.
- An analysis stored before this change has no flag and is treated as context
  only. It has almost certainly already reached the plan; a later input that asks
  for a change includes it in the prompt context anyway.
