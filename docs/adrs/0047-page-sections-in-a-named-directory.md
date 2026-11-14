# ADR 0047: Give a page's own sections a named directory

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** `docs/specs/web-component-library.md`,
  `docs/specs/llm-model-catalog.md`, issue #315

## Context

`LlmSection.tsx` had grown to 472 lines and held four unrelated concerns: the
catalog fetch, seven filter and sort states, a latest-wins save queue, the
alerts, and the model table. The three grade filters were three copies of the
same `<label><Select>` block, each with its own literal grade array and an
`as LlmModelGrade` cast that trusted the select's string.

ADR 0027 keeps page components flat in `apps/web/src/` and shared primitives in
`components/`. Neither is the right home for these pieces: they are not shared
across pages, but they are also more than one page's JSX. The coach plan had
already solved the same problem by moving its tab sections into `plan/` while
`CoachPlanView` stayed flat.

## Decision

- Move the model picker's pieces into `apps/web/src/llm/`, following `plan/`:
  - `catalogFilters.ts` — the pure filter and sort rules and the discouraged
    notice, so they can be tested without rendering;
  - `ModelFilters.tsx` — the filter bar, rendered through one `GradeSelect`,
    and the exported `LLM_GRADES` plus the `isLlmModelGrade` guard that
    validates a select's value instead of casting it;
  - `ModelTable.tsx` — the sortable table with one selection radio per role;
  - `useLlmCatalog.ts` — the catalog load and the filter and sort state, with
    the selected models kept visible;
  - `useQueuedSave.ts` — the latest-wins queued save.
- Keep `LlmSection.tsx` beside its test as the Settings-page entry point. It
  owns the key section, the alerts and the two model choices, and composes the
  pieces above. (Amended by ADR 0059: it now lives in `apps/web/src/settings/`;
  the split from the pieces in `llm/` is unchanged.)

A section that belongs to exactly one page goes in a directory named for the
page's concern, next to the page component that composes it; shared primitives
stay in `components/`.

## Alternatives considered

- **Keep one file.** Rejected: the four responsibilities already forced a
  reader to hold the fetch, the filters, the save order and the table markup at
  once, and the copied grade blocks had begun to drift.
- **Move the pieces into `components/`.** Rejected: they are the model picker's
  own sections, not primitives another page reuses, so `components/` would stop
  meaning "shared".
- **Render the grade options from a shared constant but keep the three blocks.**
  Rejected: it deduplicates the array while leaving the three labels, the
  handlers and the cast copies.
- **Drop the cast and trust the select.** Rejected: the guard is what keeps an
  unexpected value out of the filter state; the cast was only safe because the
  options happened to match the type.

## Consequences

- Each concern has a named home, and the pure filter and sort rules are tested
  without a render.
- `useQueuedSave` is generic: any form that must persist rapid edits in order
  and report only the newest answer can use it.
- The composer is the map: a reader starts at `LlmSection` and follows one
  module per concern instead of scanning a 472-line file.
- More files to open for a small change, and a new page section has to choose
  between staying flat and taking a directory — the rule is that a single
  page's own, non-shared sections may move out once they stop fitting one
  module.
