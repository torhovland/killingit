# Spec: Coach judgement

- **Status:** Accepted (implemented)
- **Date:** 2026-11-08
- **Related:** `docs/specs/coach-plan-prompts.md`,
  `docs/specs/coach-feedback-and-program-review.md`,
  `docs/specs/coach-form-awareness.md`,
  `docs/specs/location-and-weather.md`.

## Goal

Make the coach an ambitious expert rather than a cautious follower. The plan
should drive the best progress the athlete can absorb while avoiding illness and
injury, respecting the athlete's time, and respecting what they said in the
survey, comments and notes. Where the athlete commits to a specific workout, the
coach accommodates it. Where the athlete reports how they feel, the coach treats
that as evidence and decides for itself whether the plan should change.

## Scope

### In scope

1. A shared ambition rule for every plan prompt: plan for the most progress the
   athlete can absorb, not the safest defensible plan, and avoid both
   recklessness and over-caution.
2. A shared athlete-input rule: a workout the athlete says they will do is kept
   in the plan and the surrounding days are shaped around it; if the coach would
   have prescribed something else, it says so briefly in that day's description.
3. A shared feedback rule: fatigue, soreness, niggles, pain and poor sleep are
   information for the coach's holistically considered judgement, not an
   instruction to adapt the plan. The coach may change the plan or leave it
   unchanged.
4. The same judgement reaches the coach reply prompt, so a reply does not
   promise an adjustment merely because the athlete mentioned a discomfort.

### Out of scope

- Any app-side rule that overrides the coach's decision. The coach remains the
  only one that decides changes to the training plan.
- A fixed list of symptoms or a medical triage flow.

## Prompt rules

`apps/api/src/llm/promptRules.ts` owns the fragments:

- `COACH_AMBITION_RULES` states that the coach plans the most progress the
  athlete can absorb, weighs goal, time, fitness, form, recent training,
  recovery and athlete input together, and avoids both timidity and unsupported
  risk.
- `ATHLETE_INPUT_RULES` states that a stated workout is kept and planned around,
  with any disagreement stated briefly in the day's description instead of
  silently replacing the session. It also states that feedback about how the
  athlete feels is information, not an instruction; the coach is the expert,
  reads it with the training and recovery data, and may change the plan or not.

Both fragments are included in `PLAN_PROMPT_RULES`, and therefore in the season,
block, week, day, combined and update prompts, and in the coach reply prompt.
The existing plan rule about significant fatigue is worded as holistic
judgement rather than an automatic adjustment.

## Acceptance criteria

1. Every plan prompt includes `COACH_AMBITION_RULES` and
   `ATHLETE_INPUT_RULES` through `PLAN_PROMPT_RULES`.
2. The coach reply prompt includes both fragments.
3. The ambition rule asks for the best possible progress, not the safest plan,
   while still avoiding illness and injury.
4. The athlete-input rule accommodates a stated workout, and permits the coach to
   record a different opinion in the workout description.
5. The feedback rule says feedback is information rather than an instruction,
   leaves the decision with the coach, and allows either a plan change or no
   change.
6. Unit tests cover the fragment contents and their propagation.
7. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.

## Testing

- `promptRules.test.ts` asserts that `PLAN_PROMPT_RULES` composes both the
  ambition and athlete-input fragments.
- `coachReplyPrompt.test.ts` asserts that the reply system prompt carries them.
