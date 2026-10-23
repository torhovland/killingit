# Spec: Coach plan prompts

- **Status:** Accepted (implemented)
- **Date:** 2026-10-21
- **Related:** ADR 0004 (OpenRouter), `docs/specs/openrouter-llm-integration.md`,
  `docs/specs/athlete-question-answers.md`,
  `docs/specs/coach-plan-lifecycle.md`.

## Goal

Once the athlete has completed the interview, build the prompts that ask the
coach LLM for a complete, coherent training plan:

1. a season plan with blocks,
2. a plan for the block containing today,
3. a plan for the week containing today, and
4. a concrete workout or rest for today.

The prompts must carry the athlete's questions and answers and the coach's
summary of recent activities, and must explicitly require state of the art
training science.

## Scope

### In scope

1. A pure prompt builder in `apps/api/src/llm/coachPlanPrompt.ts` that accepts
   the athlete's answers, the recent activities with their coach analyses, and
   today's date (plus an optional timezone).
2. A system prompt that defines the coach role, the training-science
   requirements, the relationship between the four plan levels, and the exact
   JSON response contract.
3. A user prompt that renders the athlete profile and recent-training context.
4. A thin `generateCoachPlan` wrapper that sends the messages through the
   existing provider-agnostic `LlmProvider`.
5. Unit tests for the prompt contents and edge cases.

### Out of scope (deferred)

- Weather/daylight context in the prompt.
- Plan history/versioning.

Persistence, cascade generation, answer-change triggers, and the plan UI are
covered by `docs/specs/coach-plan-lifecycle.md`.

## Acceptance criteria

1. The system prompt instructs the model to design the season, the block
   containing today, the week containing today, and today, and to use **state of
   the art training science** for the best possible plan for the athlete.
2. The system prompt states the exact JSON shape, including the fields that tie
   the four levels together (the block is in `season.blocks`, the week is in
   `block.weeks`, and `today` matches today's `week.sessions` entry).
3. The user prompt includes every answered question with its prompt and answer,
   marks explicitly skipped questions, and marks unanswered questions.
4. The user prompt includes each recent activity's date, type, name, distance,
   moving time, elevation, and its coach analysis when present. It says so
   explicitly when no activities were recorded.
5. The prompt includes today's date and the athlete's timezone when supplied.
6. The prompt asks for an optionality assessment on today's and tomorrow's
   sessions: whether each can be skipped without undermining the plan, with a
   concise explanation either way.
7. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.

## Data-model / API impact

Adds `optional` (boolean, default `false`) and `optionalRationale` (optional
string) to `dayPlanSchema` in `@killingit/shared`, so generated day plans can
state whether a session should not be skipped or is optional. No database or
route change; stored JSON without the new fields still parses. The builder
consumes existing shapes (`StoredAthleteQuestion` and `AnalyzedActivity`)
structurally and returns `LlmProvider` chat messages.

## Technical approach

- `coachPlanPrompt.ts` exports `COACH_PLAN_PROMPT_VERSION`, the input interfaces,
  `buildCoachPlanPrompt(input)`, and `buildCoachPlanMessages(input)`. The JSON
  contract and the split daily prompt both include `optional` and
  `optionalRationale` for today's and tomorrow's sessions.
- The combined prompt describes a coherent full plan in one JSON object. The
  lifecycle build now splits the initial plan into four smaller calls (season,
  block, week, day) so every response fits the model's output budget; the
  combined prompt remains the reference contract and a full-plan fallback.
- `coachPlan.ts` exports `generateCoachPlan(provider, credentials, input)`, which
  sends the combined prompt (temperature 0.4, 4096 output tokens).
- `formatDuration` is reused from `activityPrompt.ts` so durations read the same
  way across coaching prompts.

## Testing

- Unit tests assert the system-prompt requirements, the JSON contract, the
  optionality fields for today and tomorrow, the athlete profile rendering
  (answered, skipped, unanswered), the activity rendering (with and without
  analysis), the empty-activity fallback, and the date/timezone context.
- Run `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`.
