# Spec: Coach plan prompts

- **Status:** Accepted (implemented)
- **Date:** 2026-10-21
- **Updated:** 2026-11-11 — a parity test now compares each JSON contract with
  the Zod schema that parses the coach's answer. The unused combined four-level
  prompt and its `generateCoachPlan` wrapper were removed. The shared plan
  context is composed in `planContext.ts` from the topical `profileContext.ts`,
  `activityContext.ts`, `planLevelsContext.ts`, `dietContext.ts` and
  `healthContext.ts` modules; the activity adapter lives in
  `activityContext.ts`.
- **Related:** ADR 0004 (OpenRouter), `docs/specs/openrouter-llm-integration.md`,
  `docs/specs/athlete-question-answers.md`,
  `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/coach-form-awareness.md`.

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

1. A shared `PlanContextInput` and `formatPlanContext(input)` in
   `apps/api/src/llm/planContext.ts` that accept the athlete's answers, the
   recent activities with their coach analyses, and today's date (plus an
   optional timezone).
2. Prompt builders for the split season/block/week/day build and the
   plan-update call, each composing the shared system rules and the exact JSON
   response contract.
3. A user prompt that renders the athlete profile and recent-training context.
4. Unit tests for the prompt contents and edge cases.

### Out of scope (deferred)

- Plan history/versioning.

The plan prompts include the location's combined weather and daylight (an
average of Open-Meteo and Yr.no); the provider rows are shown in the UI only.
See `docs/specs/location-and-weather.md`.

Persistence, plan updates, answer-change triggers, and the plan UI are
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
   sessions: what each session builds toward the plan's goal, what skipping it
   would cost, and — only when the cost is genuinely small — why it is safe to
   skip today. A session the coach cannot justify must be revised out of the
   week instead of labelled optional. Rest days are exempt. See
   `docs/specs/session-purpose.md`.
7. Week plans are outlines: every week session keeps the session type, a brief
   focus, an approximate duration and intensity, estimated TSS, its daily
   estimated FTP, and the week's single estimated FTP, while only the `today`
   and `tomorrow` day objects carry the full prescription. A day that has
   arrived keeps its outline and status instead of becoming an activity
   summary. See `docs/specs/week-outline.md` and `docs/specs/training-load.md`.
8. When an activity was already recorded today, today's plan keeps the planned
   workout's title, description and rationale and adds only one or two
   sentences on how much of it was completed. It does not repeat the activity
   analysis or the coach's reply to the athlete's comment.
9. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.
10. The prompt carries today's current form and the projected `ATL`, `CTL`,
    `TSB`, and form label of each supplied day, and the shared
    `FORM_TARGET_RULES` asks the coach to keep the planned week in Productive
    unless the rationale justifies leaving it. See
    `docs/specs/coach-form-awareness.md`.
11. Every plan prompt carries the shared ambition and athlete-input rules: the
    plan drives the best progress the athlete can absorb without being
    over-cautious, a workout the athlete has committed to is kept, and feedback
    about how they feel is evidence for the coach's decision rather than an
    instruction to change the plan. See `docs/specs/coach-judgement.md`.

## Data-model / API impact

Adds `optional` (boolean, default `false`) and `optionalRationale` (optional
string) to `dayPlanSchema` in `@killingit/shared`, so generated day plans can
state whether skipping a session costs little today and why the session matters
toward the plan's goal. It also adds an optional `bikeWorkout` (FTP plus ordered
intervals) to day plans for indoor bike sessions with power targets; the field
stays optional on week sessions so stored plans still parse, but week outlines
no longer set it. See `docs/specs/bike-workout-export.md`. No database or route
change; stored JSON without the new fields still parses. The builder consumes
existing shapes (`StoredAthleteQuestion` and `AnalyzedActivity`) structurally
and returns `LlmProvider` chat messages.

## Technical approach

- `promptRules.ts` owns every rule and JSON contract shared by more than one
  prompt: the coach persona and training-science requirement, the standard input
  guidance, week-shape and completed-session rules, the outline, session-purpose,
  rationale, weather, bike-workout, training-load, enum, JSON and text-formatting
  rules, the season/block/week/day contracts and their nested bike-workout
  contract, the response-key sentence, and the activity-review rules. Each prompt
  composes those constants instead of restating them, so a change reaches the
  initial build, the combined plan, every update and the activity reviews
  together. The `promptSections` helper keeps each shared fragment on its own
  section, separate from prompt-specific prose, so a fragment can be updated
  without rewriting the surrounding text. Every prompt starts with the literal
  `GLOBAL_PROMPT_RULES`: the coach persona, direct second-person address, the
  no-invention rule (with FTP/TSS inference allowed), the body-measurement
  limits and units, and the activity-comment rule. Rules that every plan prompt
  includes are merged into `PLAN_PROMPT_RULES`: the training-science
  requirement, the standard input guidance, the rationale rules and the
  body-metric output fields.
- Every strictly JSON coach response also carries `coachQuestion` (one important
  clarification question, or null) and `modelsRemarks` (the model's own
  difficulties, inconsistencies or objections, or null). The app shows the
  newest pending question on the dashboard, stores answered questions for the
  season review, and lists recent non-null model remarks on the admin page. See
  `docs/specs/coach-questions.md`.
- `planContext.ts` exports `PlanContextInput` and `formatPlanContext`; the level
  formatters live in `planLevelsContext.ts` and `toCoachPlanActivity` lives in
  `activityContext.ts`, which adapts a stored analysed activity for a plan
  prompt. The split and update prompts assemble their
  response contracts from the same level contracts, including `optional`,
  `optionalRationale`, `status`, the indoor/outdoor fields, `bikeWorkout`,
  `estimatedTss`, the daily `estimatedFtpWatts` and the dated `bodyMetrics`
  array that carries the body weight and body-fat values the coach found in the
  athlete's input (see `docs/specs/body-metrics.md`).
- The lifecycle build splits the initial plan into four smaller calls (season,
  block, week, day) so every response fits the model's output budget. There is
  no combined full-plan prompt: the split build and the update prompt are the
  only paths that call the model for a plan.
- `planUpdatePrompt.ts` also exports `PLAN_UPDATE_SYSTEM_PROMPT`,
  `buildPlanUpdateMessages(input)` and `PlanUpdateInput` for the single update
  prompt. It receives every current level (season, block, week, today,
  tomorrow, next week and next block) and a revision request. The response is
  the full `CoachPlan` shape, so the coach can show a revised block with its
  week and day instead of the API chaining separate calls. See ADR 0013.
- Every plan prompt uses the same rationale, outline, weather, bike-workout,
  training-load, body-metric, session-purpose and enum rules. The initial
  season and block prompts also ask for a rationale and the training-load
  estimates, so a plan looks the same whichever completion built it.
  `formatWeekPlan` and `formatDayPlan` include each supplied day's projected
  `ATL`, `CTL`, `TSB` and form label, and `formatPlanContext` includes today's
  current form, so the coach can keep the week inside the Productive band. See
  `docs/specs/coach-form-awareness.md`.
- Every update rationale explains the plan as it stands, not the revision
  itself. The prompt rejects change-log phrasing such as "we adjusted" or "this
  replaces" and asks for the reason the current plan is right from this point
  forward.
- A recorded activity does not replace today's prescription in the plan. The
  completed-session rule keeps the planned workout's title, description and
  rationale and appends a short completion note, so the plan does not restate
  the activity analysis or the coach's reply to the athlete's comment. A past
  week session keeps its outline and records only its completion status.
- A season update uses that same prompt: it receives the existing season and
  current block, keeps completed blocks and the season goal as reference, and
  re-plans the future from the athlete's latest input. A new season still uses
  the split build because there is no stored plan to update. See
  `docs/specs/season-regeneration.md`.
- The split season/block/week/day plan calls and the plan-update call share
  `PLAN_MAX_TOKENS`. Reasoning tokens count against it; `completeWithFallbacks`
  retries with a larger budget (up to 32,768) when a model is truncated.
- `formatDuration` comes from `@killingit/shared` so durations read the same
  way across coaching prompts and the web app. The activity review shares
  `formatActivitySummary` from `activityContext.ts`, `formatFtpContext` from
  `profileContext.ts`, and `formatPlanLevels` and `formatPlannedSession` from
  `planLevelsContext.ts` with the plan prompts, so both describe the same
  activity and planned session the same way.

## Testing

- Unit tests assert the system-prompt requirements, the JSON contract, the
  optionality fields for today and tomorrow, the athlete profile rendering
  (answered, skipped, unanswered), the activity rendering (with and without
  analysis), the empty-activity fallback, the date/timezone context, and the
  analysed-activity adapter.
- `apps/api/src/llm/promptContracts.test.ts` holds each contract to the Zod
  schema that parses the coach's answer: it parses both sides into the same key
  tree and fails with the contract, the path and the key when a field exists on
  one side only. The schema keys the API attaches after the coach responds
  (`forecasts`, `weather`, `trainingLoad`, and the season and block
  `estimatedFtpWatts`) are listed in the test, so they stay out of the contracts
  it asks the model to fill.
- Run `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`.
