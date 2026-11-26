# Spec: Plan rationales as spoken coach quotes

- **Status:** Accepted (implemented)
- **Date:** 2026-11-26
- **Related:** `docs/specs/coach-answer-voice.md`,
  `docs/specs/coach-plan-prompts.md`, `docs/specs/web-component-library.md`,
  `docs/specs/week-outline.md`.

## Goal

Show every plan rationale as something the coach says to the athlete. The
season, block, week and day views drop the "Coach's rationale" heading, render
the rationale in a quote section beside the coach's avatar, and ask the model
for rationale prose in the same spoken register the coach uses when answering
the athlete. The rationale therefore looks and reads like the coach talking,
not like a report attached to the plan.

## Scope

### In scope

1. A `CoachQuote` primitive in `apps/web/src/components/` that renders a
   `<figure>` with the coach avatar and a `<blockquote>` containing the
   formatted rationale. It replaces the rationale heading in the season, block,
   week and day plan sections.
2. A `CoachAvatar` primitive that draws the coach as a small inline SVG in the
   brand palette: a head wearing a slightly rotated cap. It is decorative and
   hidden from assistive technology, because the quote itself carries the
   content.
3. A shared spoken register in `apps/api/src/llm/promptRules.ts`. Both
   `SPOKEN_ANSWER_RULES` and the new `SPOKEN_RATIONALE_RULES` compose the same
   register fragment, and `RATIONALE_RULES` adds the rationale-specific
   instructions. `PLAN_PROMPT_RULES` composes `RATIONALE_RULES`, so every plan
   prompt asks for spoken rationales at every level.
4. The day plan's optional-session box ("Why this session matters") keeps its
   current layout and badge. It is a decision aid, not a second rationale.

### Out of scope

- Changing the register of plan fields other than `rationale`: titles,
  descriptions, focus, objectives, target loads and JSON fields stay written
  plan text.
- Regenerating stored plans. Existing rationales keep their current wording
  until the coach next revises that level.
- A stored coach avatar, a configurable persona or an athlete-uploaded image.
- Changing plan temperature, which stays the lower `PLAN_TEMPERATURE`.

## Acceptance criteria

1. `CoachQuote` renders a real `<blockquote>` and the coach avatar, keeps the
   caller's test id and optional layout class, and formats paragraphs and lists
   through `FormattedText`.
2. Season, block, week and today/tomorrow day rationales render through
   `CoachQuote`; no plan section shows a "Coach's rationale" heading.
3. The day's optional-session box is unchanged.
4. `SPOKEN_RATIONALE_RULES` composes the same spoken-register fragment as
   `SPOKEN_ANSWER_RULES`, and `PLAN_PROMPT_RULES` contains it, so the season,
   block, week and day prompts all ask for spoken rationale prose.
5. The rationale rules still reject change-log phrasing and still ask for the
   reason the current plan is right from this point forward.
6. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run check:unused`
   and `bun run test` pass.

## Data-model / API impact

None. The `rationale` fields already exist on the season, block, week and day
schemas in `@killingit/shared`; only their prose register and presentation
change.

## Technical approach

- `apps/web/src/components/CoachAvatar.tsx` draws the avatar inline with the
  palette utilities (`fill-primary`, `fill-accent`, `fill-foreground`,
  `fill-background`), a `useId()`-scoped clip path and `aria-hidden="true"`. No
  image asset or hard-coded colour is added.
- `apps/web/src/components/CoachQuote.tsx` owns the quote layout: the avatar
  beside a left-accented `<blockquote>`, with a visually hidden `<figcaption>`
  naming the coach. It reuses `FormattedText`, so lists and paragraphs render as
  they do elsewhere.
- `SeasonSection`, `BlockSection`, `WeekSection` and `DayCard` replace their
  rationale block with `CoachQuote`, keeping the existing test ids
  (`season-rationale`, `block-rationale`, `week-rationale` and
  `${testId}-rationale`).
- `promptRules.ts` extracts the spoken register into one non-exported fragment.
  `SPOKEN_ANSWER_RULES` and `SPOKEN_RATIONALE_RULES` both compose it, and
  `RATIONALE_RULES` composes the rationale paragraph with
  `SPOKEN_RATIONALE_RULES`. `PLAN_PROMPT_RULES` includes `RATIONALE_RULES`.

## Testing

- `apps/web/src/components/CoachQuote.test.tsx` asserts the figure, avatar,
  blockquote, formatted lists, test id and caller class, and that no rationale
  heading is emitted.
- `CoachPlanView.levels.test.tsx` asserts the week, block and season rationales
  render inside a blockquote, and `CoachPlanView.test.tsx` keeps covering the
  day rationale.
- `apps/api/src/llm/promptRules.test.ts` asserts `PLAN_PROMPT_RULES` composes
  `SPOKEN_RATIONALE_RULES` and that both spoken fragments share the register.
- Run `bun run typecheck`, `bun run lint`, `bun run format`,
  `bun run check:unused` and `bun run test`.
