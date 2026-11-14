# Web form drafts

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** issue #312, `docs/adrs/0046-form-drafts-follow-props.md`,
  `docs/specs/web-interaction-tests.md`.

## Goal

A form control whose value starts from a prop must keep an unsaved edit when
its parent re-renders, and must still pick up a genuinely new value from the
server. Neither behaviour may depend on the identity of the prop object, and no
effect may copy the prop into state just to keep the form in step.

## Scope

Two settings forms copied a prop into local state and got the behaviour wrong
in opposite directions:

- `LocationSection` reset its draft in an effect on every new `location` object.
  A parent re-render with an equal location threw away a point the athlete had
  picked but not saved, and the effect added a render pass on every change.
- `LlmSection` initialised its model choices once with `useState`. A later
  `settings` payload — for example the server's answer after the OpenRouter key
  was saved — never reached the radio buttons.

The fix is a shared hook, `usePropDraft` in `apps/web/src/usePropDraft.ts`:

```ts
const draft = usePropDraft(source, isEqual);
draft.value; // source, or the edit while its base is still the source
draft.update(next); // records an edit based on the current source
```

The hook stores the source value the edit was based on. It shows the edit only
while the current source is equal to that base; once the source holds a
different value, the source wins. Equality is the caller's, so a new object with
the same fields is not a change (`sameLocation` for the location, the two model
ids for the picker). Because the value is derived during render and updated only
from event handlers, the form neither renders twice nor needs an effect.

## Behaviour

- An unsaved draft survives any parent re-render that leaves its saved value
  unchanged, including one that passes an equal new object.
- A new saved value replaces the draft. For the location this is the point
  returned by another save or another tab; for the model picker it is the
  server's answer to the key save.
- A local model choice made before the first key save is kept while the
  settings are unchanged and travels with the key, as before. Once the server
  reports the stored choices, those choices are shown.

## Acceptance criteria

- `LocationSection` keeps a searched point when re-rendered with the same saved
  location, follows a changed saved location, and contains no effect that resets
  its draft.
- `LlmSection` keeps a chosen model across an equal settings re-render and
  follows a later settings payload for both roles; its initial value still
  falls back to the single legacy `model`.
- `usePropDraft` has a unit test for the equal-new-object and changed-value
  cases.
- `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`,
  `bun run test:coverage`, `bun run check:unused` and `bun run test:e2e` pass.

## Data model and API impact

None. This is web form state only; no route, schema or prompt changes.
