# Spec: Coach personality

- **Status:** Accepted (implemented)
- **Date:** 2026-11-08
- **Related:** `docs/specs/coach-plan-prompts.md`,
  `docs/specs/coach-judgement.md`,
  `docs/specs/coach-feedback-and-program-review.md`,
  `docs/specs/period-reviews.md`.

## Goal

Give the coach a consistent human personality across every plan and every
message to the athlete. The coach should read like a real endurance coach who is
tough but warm, relaxed, good-humoured, and well liked, rather than a neutral
text generator. The coaching advice stays professional and specific; the
personality colours how it is said, not what is prescribed.

## Scope

### In scope

1. A shared personality fragment in
   `apps/api/src/llm/promptRules.ts` that defines the coach's voice and is
   included in `GLOBAL_PROMPT_RULES`, so every prompt inherits it.
2. The coach never describes itself as an AI, an AI coach, a chatbot, a language
   model, an algorithm, or an app. It speaks as the athlete's coach.
3. Humour is permitted but sparing and discreet. It never replaces the coaching
   information, is never forced, and never makes the athlete the butt of it.
4. The coach may show a trace of disappointment when the athlete falls short of
   what was expected, and is encouraged to show pride and happiness when the
   athlete does particularly well. Both reactions stay brief and proportionate.
5. A new season opens with an introduction. The season plan gains an
   `introduction` field: a short greeting from the coach that introduces them,
   greets the athlete, and says how much they look forward to working together.
   The introduction is shown on the Season tab.
6. The introduction belongs to the season. A later season refresh keeps the
   stored greeting instead of reintroducing the coach.

### Out of scope

- A named coach persona, a fixed biography, or a cast of characters.
- Changing the app's marketing copy on the signed-out landing page.
- App-side sentiment analysis or automatic celebration. The coach still decides
  how to react from the training data and the athlete's input.

## Prompt rules

`apps/api/src/llm/promptRules.ts` owns the fragments:

- `COACH_PERSONALITY_RULES` defines the human voice: tough but warm, relaxed,
  good-humoured, focused on the coaching, sparing with humour, never an AI, and
  willing to show pride or a trace of disappointment. It is part of
  `GLOBAL_PROMPT_RULES`, so the season, block, week, day, combined, update,
  activity review, program review, period review, coach reply and meal prompts
  all use it.
- `SEASON_INTRODUCTION_RULES` asks a new season for a short greeting in
  `introduction`, separate from the plan rationale.

The `introduction` field is added to `SEASON_CONTRACT` as `"string | null"`. The
initial season prompt requires it; the plan-update prompt keeps the stored value.

## Data-model / API impact

`seasonPlanSchema` in `@killingit/shared` gains an optional nullable
`introduction` string, so plans stored before this change still parse. The
season build schema requires a non-empty introduction, so a model that omits it
is repaired rather than storing a season without a greeting. No database or
route change: the field lives inside the existing season JSON.

The plan update preserves the stored introduction when the response omits it,
so a season refresh cannot silently drop the greeting.

## Acceptance criteria

1. `GLOBAL_PROMPT_RULES` contains `COACH_PERSONALITY_RULES`, and every prompt
   starts with `GLOBAL_PROMPT_RULES`.
2. The personality fragment describes a tough but warm, relaxed coach with a
   sense of humour, asks for humour sparingly and discreetly, and keeps the
   professional coaching output the focus.
3. The fragment forbids describing the coach as an AI coach or similar, and
   allows a brief trace of disappointment and genuine pride.
4. The season plan prompt asks for an introduction and the initial season
   response requires a non-empty one.
5. The Season tab shows the stored introduction above the season rationale.
6. A season refresh keeps the stored introduction.
7. Activity, program, period, reply and food prompts inherit the personality
   through `GLOBAL_PROMPT_RULES`; their prompt versions are bumped so cached
   analyses and reviews are regenerated in the new voice.
8. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.

## Testing

- `promptRules.test.ts` asserts the personality wording, the AI prohibition, the
  humour limits, the pride/disappointment permission, and that `GLOBAL_PROMPT_RULES`
  and `PLAN_PROMPT_RULES` carry it.
- `planInitialPrompt.test.ts` asserts the season prompt asks for the
  introduction.
- `planUpdatePrompt.test.ts` asserts the update prompt keeps the introduction.
- `plan.test.ts` asserts the season schema parses an introduction, defaults a
  missing one, and rejects a season build without one.
- `generate.test.ts` asserts a season refresh preserves the stored introduction.
- `CoachPlanView.test.tsx` asserts the Season tab renders the introduction.
