# Spec: Explain why today's and tomorrow's sessions matter

- **Status:** Accepted (implemented)
- **Date:** 2026-10-25
- **Related:** `docs/specs/coach-plan-prompts.md`,
  `docs/specs/coach-plan-lifecycle.md`.

## Goal

Make the Day tab motivate the athlete. For today's and tomorrow's workout, the
coach must explain the session's purpose in terms of the plan's goal and what
skipping it would cost — not just label the session "optional" or "do not skip".

## Scope

### In scope

1. The day-plan rationale about optionality (`optionalRationale`) must state the
   concrete benefit toward the season goal, block focus, and week target load,
   and the concrete loss if the athlete skips the session.
2. The coach must treat a session it cannot justify as a sign that the week is
   not good enough: it revises the week (or replaces the session with rest)
   instead of writing a vague rationale or hiding filler behind "optional".
3. "Optional" remains a valid signal, but only when the cost of skipping is
   genuinely small and the coach can say why it is acceptable today.
4. The Day card presents the session's purpose first ("Why this session
   matters") and keeps the skip guidance as a badge. Rest days do not show the
   skip guidance.

### Out of scope

- Adding per-session purpose text to every day in the Week tab.
- Changing the four-level plan shape or the database schema.
- Validating the rationale's semantics at runtime.

## Acceptance criteria

1. The daily-update and combined plan prompts require a goal-linked explanation
   of what the session builds and what skipping costs.
2. They instruct the coach to revise the week when a session has no concrete
   purpose, rather than mark it optional.
3. They exempt rest days from the optionality assessment.
4. `CoachPlanView` renders the rationale under "Why this session matters" with a
   "Do not skip this session" / "Optional session" badge, and hides it for rest
   days.
5. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.

## Data-model / API impact

No change to `coachPlans` or the API. The meaning of the existing
`dayPlanSchema` fields is sharpened:

- `optional` — true only when skipping the session costs little today.
- `optionalRationale` — the session's purpose toward the goal and the cost of
  skipping it; for optional sessions, why that cost is acceptable.

`optionalRationale` stays optional in the schema so plans stored before this
change still parse; new generations are prompted to provide it for workouts.

## Technical approach

- A shared `SESSION_PURPOSE_RULES` constant in `planContext.ts` is used by both
  `COACH_PLAN_SYSTEM_PROMPT` and `DAILY_UPDATE_SYSTEM_PROMPT`, so the wording
  cannot drift between the reference contract and the live plan update.
- `COACH_PLAN_PROMPT_VERSION` is bumped because the prompt changed materially.
- `CoachPlanView` keeps the existing `optional` flag to choose the badge but
  frames the block around the session's purpose.

## Testing

- Prompt unit tests assert the goal-linked loss requirement, the filler/revise
  instruction, and the rest-day exemption.
- The web render test asserts the purpose heading, both badges, the goal-linked
  text for today and tomorrow, and that rest days do not show the block.
- Run `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`.
