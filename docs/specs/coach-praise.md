# Spec: Coach praise for standout workouts

- **Status:** Accepted (implemented)
- **Date:** 2026-11-08
- **Related:** `docs/specs/coach-personality.md`,
  `docs/specs/coach-feedback-and-program-review.md`.

## Goal

When a workout deserves it, the coach says so in plain words rather than
burying it in a neutral summary. A race, or an effort far above the athlete's
ordinary training, that was performed well must earn an explicit "you are
killing it". The same praise occasionally reaches an ordinary workout that was
simply well executed, so the coach does not only celebrate the exceptional days.

## Scope

### In scope

1. A shared `ACTIVITY_PRAISE_RULES` fragment in
   `apps/api/src/llm/promptRules.ts`. It is included in every workout review. It
   tells the coach to say that the athlete is killing it after a well-performed
   race or an effort far above the athlete's ordinary training.
2. A shared `ACTIVITY_EXTRA_PRAISE_RULES` fragment. When included, it extends the
   same praise to any well-executed workout, even one that was not a race or out
   of the ordinary, and tells the coach not to force it after a poor session.
3. The extra fragment is included at random. Building a workout-review prompt
   draws a number from 0 up to and including 14; only a draw of 0 includes
   `ACTIVITY_EXTRA_PRAISE_RULES`. `rollExtraPraise(random)` in `promptRules.ts`
   owns the draw so the range is defined once.
4. The activity analysis (`activityPrompt.ts`) uses the rule. Each prompt build
   draws independently.
5. `ANALYSIS_PROMPT_VERSION` is bumped so each stored analysis records the
   instruction that produced it. Existing cached analyses are reused; newly
   generated ones use the new rule.

### Out of scope

- App-side sentiment analysis or automatic celebration written without the
  coach. The model still decides from the workout data whether the performance
  was good; the app only decides whether the occasional extra instruction is
  present.
- Mentioning the random draw or the instruction itself to the athlete.

## Prompt rules

`apps/api/src/llm/promptRules.ts` owns the fragments and the draw:

- `ACTIVITY_PRAISE_RULES` is part of the system prompt of both workout reviews.
  It names the conditions (a race or an effort far above the ordinary, performed
  well) and asks for the exact words "killing it" in the coach's own voice.
- `ACTIVITY_EXTRA_PRAISE_RULES` is added to the user prompt when the draw is 0.
  It repeats the praise for a well-executed ordinary workout and says not to
  force it after a poor session.
- `EXTRA_PRAISE_DRAW_RANGE` is 15, and `rollExtraPraise(random)` returns true
  exactly when `Math.floor(random() * 15)` is 0, matching 0 up to and including 14.

## Acceptance criteria

1. Every activity-analysis prompt contains `ACTIVITY_PRAISE_RULES`.
2. A prompt built with a draw of 0 contains `ACTIVITY_EXTRA_PRAISE_RULES`; a
   prompt built with any other draw does not.
3. The draw covers 0 up to and including 14 and includes the extra rule only for 0.
4. Changing the rule or the draw bumps both workout-review prompt versions.
5. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.

## Testing

- `promptRules.test.ts` asserts both fragments and the draw boundaries.
- `activityPrompt.test.ts` asserts the always-on rule in the system prompt, the
  extra rule at draw 0, and its absence at another draw.
