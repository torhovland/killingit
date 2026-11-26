# Spec: Spoken coach answers

- **Status:** Accepted (implemented)
- **Date:** 2026-11-26
- **Related:** `docs/specs/coach-personality.md`,
  `docs/specs/coach-feedback-and-program-review.md`,
  `docs/specs/coach-reply-context.md`, `docs/specs/period-reviews.md`,
  `docs/specs/coach-questions.md`.

## Goal

When the coach answers something the athlete wrote or said — a workout comment,
a weekly note, a review comment, a one-off "by the way" question, or an answer to
the coach's own question — the answer should read like the coach speaking to the
athlete, not like a written report. The registered coach personality carries the
tone; the spoken register carries the language, so the same answer feels human
and personal instead of formal and repetitive.

Repeated answers should also stop sounding identical. The same coaching point can
be true two days in a row, but the athlete should hear it in fresh wording each
time rather than read the same stock reply with the details swapped.

## Scope

### In scope

1. A shared `SPOKEN_ANSWER_RULES` fragment in
   `apps/api/src/llm/promptRules.ts`: everyday words, contractions, short
   sentences, direct address, and no report or essay voice. The coaching stays
   specific; the personality colours how it is said.
2. A shared `ANSWER_VARIETY_RULES` fragment that asks for a different opening,
   sentence shape and wording on each answer, and forbids reusing one template
   with the details changed.
3. The fragments reach every prompt that answers the athlete: the activity
   comment, weekly note, manual activity, review comment, coach-question answer
   and one-off question replies, plus the activity review and the completed week
   and block reviews.
4. The conversational answer temperature rises from 0.4 to 0.8, and the activity
   and period review temperature from 0.3 to 0.5. Plan JSON stays at 0.4, and
   extraction and repair stay at 0.2, because those outputs need stability, not
   variation.

### Out of scope

- Changing the coach personality itself, or giving the coach a named persona.
- Making plan rationales, descriptions or JSON fields spoken. They remain
  written plan text and keep the lower plan temperature.
- Randomising the coach's judgement, the plan-change scope, or the coaching
  advice. Only the language varies.

## Prompt rules

`apps/api/src/llm/promptRules.ts` owns the fragments:

- `SPOKEN_ANSWER_RULES` makes the answer read like speech: everyday words,
  contractions, short sentences, direct second-person address, no report voice,
  no formal or corporate phrasing, and no headings.
- `ANSWER_VARIETY_RULES` forbids reusing a formula from earlier answers and asks
  for a fresh opening, sentence shape and wording. It also says two answers to
  different inputs must not read like one template with the details swapped.

`GLOBAL_PROMPT_RULES` does not include either fragment: a plan is still written
text. `coachReplyPrompt` (single, batched and quick-question paths),
`periodReviewPrompt` and `activityPrompt` each compose them, and the batched reply
inherits them through `COACH_REPLY_SYSTEM_PROMPT`.

## Generation parameters

`apps/api/src/llm/sampling.ts`:

| Constant                  | Before | After |
| ------------------------- | ------ | ----- |
| `COACH_REPLY_TEMPERATURE` | 0.4    | 0.8   |
| `ANALYSIS_TEMPERATURE`    | 0.3    | 0.5   |
| `PLAN_TEMPERATURE`        | 0.4    | 0.4   |
| `REPAIR_TEMPERATURE`      | 0.2    | 0.2   |

The prompt versions are bumped for the changed prompts:
`ANALYSIS_PROMPT_VERSION` to 21 and `PERIOD_REVIEW_PROMPT_VERSION` to 5. Replies
carry no prompt version.

## Acceptance criteria

1. The activity review, completed week and block review, coach reply, batched
   reply, quick question and coach-question answer prompts contain
   `SPOKEN_ANSWER_RULES` and `ANSWER_VARIETY_RULES`.
2. `SPOKEN_ANSWER_RULES` asks for spoken language, contractions, short sentences
   and direct address, and rules out a report or essay voice.
3. `ANSWER_VARIETY_RULES` asks for a fresh opening and wording and forbids
   reusing a stock template.
4. The reply temperature is higher than the plan temperature, and the review
   temperature is higher than the repair temperature.
5. The plan, food and repair temperatures are unchanged.
6. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run check:unused`
   and `bun run test` pass.

## Testing

- `coachReplyPrompt.test.ts` asserts both fragments in the reply and quick
  question system prompts.
- `periodReviewPrompt.test.ts` asserts both fragments and the bumped version.
- `activityPrompt.test.ts` asserts both fragments in the review system prompt.
- `sampling.test.ts` asserts the answer temperatures stay above the plan and
  repair temperatures.
