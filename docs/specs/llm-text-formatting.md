# Spec: Formatting of long coach text

- **Status:** Accepted (implemented)
- **Date:** 2026-11-02
- **Related:** `docs/specs/coach-plan-prompts.md`,
  `docs/specs/coach-feedback-and-program-review.md`,
  `docs/specs/period-reviews.md`.

## Goal

Long coach text should be easy to scan. The daily workout, plan descriptions and
rationales, period reviews, activity feedback, coach replies and other long
output from the LLM should use paragraphs, bullet lists and numbered lists
instead of one dense block of prose. The web app must render that structure as
real HTML paragraphs and lists, not as literal `-` or `1.` text.

## Scope

### In scope

1. A shared prompt fragment, `TEXT_FORMATTING_RULES`, that tells the model to:
   - separate paragraphs with a blank line,
   - start each bullet on its own line with `- `,
   - start each numbered item on its own line with `1. `, `2. `, and so on,
   - prefer a list for the main set, steps or several separate points,
   - avoid headings, bold, italics, links, tables and code blocks, and
   - keep titles, focuses and names as short plain phrases.
2. Add the fragment to every plan prompt (through `PLAN_PROMPT_RULES`) and to
   the activity review, program review, period review and coach reply prompts.
3. A presentational `FormattedText` component in `apps/web` that parses the
   agreed plain-text structure into React paragraphs, `<ul>` lists and `<ol>`
   lists. Inline `**bold**` is rendered as `<strong>` as a safety net.
4. Use `FormattedText` for every long text field the coach writes:
   - day description, rationale and optional rationale,
   - week and block rationale,
   - session descriptions in the week view,
   - season, block and activity analyses,
   - period review summaries and coach replies,
   - coach questions and their replies,
   - weekly-note, by-the-way and calendar coach replies.
5. Bump the cached prompt versions whose prompts change, so older reviews are
   regenerated.

### Out of scope

- Rendering arbitrary markdown or user-supplied HTML. The parser only supports
  the agreed structure and never uses `dangerouslySetInnerHTML`.
- Headings, tables, links, images, nested lists and code blocks.
- Rendering structure in athlete-written text (comments, notes, survey
  answers); that remains plain text with its line breaks preserved.

## Acceptance criteria

1. Every plan prompt contains `TEXT_FORMATTING_RULES`; the activity review,
   program review, period review and coach reply system prompts contain it too.
2. The rule asks for paragraphs separated by a blank line, `- ` bullets and
   `1. ` numbered items, and explicitly forbids other markdown.
3. `FormattedText` renders:
   - one or more blank-line-separated paragraphs as `<p>` elements,
   - consecutive bullet lines as a `<ul>` with `<li>` items,
   - consecutive numbered lines as an `<ol>` with `<li>` items,
   - a paragraph followed by a list without a blank line as two blocks,
   - `**bold**` as `<strong>`,
   - all other characters as escaped text.
4. An empty or whitespace-only string renders nothing.
5. The daily workout description, plan rationales, activity analyses, period
   reviews and coach replies render their lists as HTML lists.
6. `bun run typecheck`, `bun run lint`, `bun run format` and `bun run test`
   pass.

## Data-model / API impact

None. The stored text remains a plain string; newlines are already valid in
every existing text column. No migration or route change is needed.

## Technical approach

- `promptRules.ts` owns `TEXT_FORMATTING_RULES` and composes it into
  `PLAN_PROMPT_RULES`, so every plan build and update shares one instruction.
  The review and reply prompts import the same fragment instead of repeating
  it.
- `FormattedText.tsx` keeps the parser small and deterministic: split on blank
  lines, classify each line as paragraph text, a `- ` / `* ` bullet or a
  `1. ` / `1) ` numbered item, then render React elements. React escapes the
  text, so no HTML sanitising library is needed.
- Existing `whitespace-pre-line` paragraphs for coach-written text are replaced
  by `FormattedText`. Athlete-written text keeps its whitespace-preserving
  rendering.

## Testing

- Unit tests for each `FormattedText` block type, inline bold, empty input and
  HTML escaping.
- Component tests assert that an analysis and a day description with a list
  render a `<ul>`.
- Prompt tests assert that the shared rule is present in every prompt family.
- Run `bun run typecheck`, `bun run lint`, `bun run format` and `bun run test`.
