# ADR 0046: Derive form drafts from their prop instead of copying it

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** `docs/specs/web-form-drafts.md`, issue #312

## Context

Two settings forms started from a value owned by the server and copied it into
local state. The location picker reset its draft with
`useEffect(() => setDraft(location), [location])`; the LLM model picker
initialised `useState(settings.seasonModel …)` once. Both approaches look
reasonable and both fail:

- The effect compares the prop by object identity, so a parent re-render that
  supplies an equal new object rewinds an unsaved edit. It also runs after
  every commit, adding a second render for a value that was already correct.
- The initialiser only runs on mount, so a later server value — the settings
  returned after an OpenRouter key save — never reaches the radio buttons.

Resetting the form with a `key` would make a genuine value change replace the
whole component, including its catalog fetch, filters and search results. That
is too blunt for these forms.

## Decision

- Add `usePropDraft(source, isEqual)` in `apps/web/src/usePropDraft.ts`. It
  holds an edit together with the source value it was based on and returns the
  edit only while the current source still equals that base. `update` records a
  new edit against the current source.
- Callers supply the equality: `sameLocation` for a location and the two model
  ids for the LLM picker, so a new object with equal fields is not a change.
- Do not use an effect to synchronise the prop into state, and do not remount a
  form to reset it.
- Use the hook in `LocationSection` and `LlmSection`; both keep their existing
  save flows and optimistic updates.

## Alternatives considered

- **Reset via `key`.** Suggested in the issue, but it remounts the whole
  section on every saved value. The location picker would lose its map view and
  search results, and the model section would re-fetch the catalog and reset
  its filters. Rejected for these components.
- **Adjust state during render** (`if (source !== seen) set…`). This follows
  React's documented alternative to an effect and resets on a genuine change,
  but it performs a second render pass on that change and reintroduces the
  identity comparison the effect got wrong. The derived value needs neither.
- **Keep the effect and compare with `isEqual`.** It would stop discarding the
  draft, but the extra commit on every change remains and a form still has two
  sources of truth. Rejected.

## Consequences

- An unsaved draft survives parent re-renders with an equal value and yields to
  a genuinely new server value, with one render and no effect.
- The hook is the shared answer for this pattern; a future form that starts
  from a server value uses it rather than copying a prop into `useState`.
- An edit whose base value later returns (the source goes A → B → A) would be
  shown again. In these forms the value is authoritative from a save, and
  returning to an older value is not a case the app produces; a consumer that
  needs stricter reset semantics must key or unmount the form deliberately.
