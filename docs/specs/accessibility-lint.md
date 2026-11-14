# Spec: Accessibility lint

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** ADR 0041, issues #305 and #324,
  `docs/specs/web-component-library.md`, `docs/specs/web-interaction-tests.md`,
  `AGENTS.md`.

## Goal

Catch accessibility barriers in the web app's JSX while the author is writing
it, instead of leaving them to manual review or to the separate a11y issues.
The lint gate fails the build for the common mechanical mistakes: an image
without alternative text, a form label detached from its control, a click
handler on an element that cannot be operated from the keyboard, a positive
tab index, and invalid ARIA.

## Scope

### In scope

1. `eslint-plugin-jsx-a11y` as a root dev dependency, with the plugin's
   `flatConfigs.recommended` preset applied to `apps/web/**/*.{ts,tsx}`.
2. The existing `bun run lint` script and the CI lint job enforce it; no new
   script or workflow step is needed because every web source file already
   goes through `eslint .`.
3. The web app's primitives (`Input`, `Textarea`, `Select`) are declared as the
   native controls they render through the plugin's `components` setting, so a
   wrapping `<label>` is recognised as associated without repeating an `id` at
   every call site.
4. Fixing every finding the preset reported when it was introduced.

### Out of scope

- Behavioural accessibility that static analysis cannot see: focus traps, chart
  data exposed to screen readers, sort announcements, and a menu primitive.
  Those stay in their own a11y issues (#325–#328). The location map's keyboard
  path (#324) is implemented and guarded by interaction tests rather than by a
  lint rule, because whether keys actually move the map is behaviour, not JSX.
- Running the rules over non-React code (the API, scripts, shared package) and
  over the Playwright config. Only the web app renders JSX.

## Acceptance criteria

1. `bun run lint` passes on a clean tree with the plugin enabled.
2. Adding an `<img>` without `alt`, a `<label>` without a control, an
   `onClick` on a non-interactive `<div>`, or a non-SVG `role="img"` with a
   pointer handler makes `bun run lint` fail, so CI catches the regression.
3. The findings the preset reported are fixed rather than suppressed: no
   `eslint-disable` comment was added.
4. `bun run typecheck`, `bun run format` and `bun run test` still pass.

## Findings fixed

- A wrapping `<label>` around the `Input`/`Textarea` primitives was reported as
  detached. The primitives forward every prop to the native element, so the
  mapping above describes them correctly; no markup changed.
- The two meal preview images used "photo" in their `alt` text, which a screen
  reader would announce twice. They now read "The meal you attached" and "The
  replacement meal".
- The modal backdrop was a `role="presentation"` `<div>` with a click handler.
  It is now a real `<button aria-label="Close dialog">` behind the panel: the
  pointer-only close path gets an accessible name, and Escape remains the
  keyboard path.

## Follow-up checks

The location map (#324) exposed two gaps in the recommended preset:

1. **`role="application"` and focus.** `jsx-a11y` classifies `application` as a
   structural role, so `no-noninteractive-tabindex` rejects a focusable map
   even though ARIA gives `application` its own key-handling mode. The rule's
   documented `roles` option now names `application`, and only that role;
   every other non-interactive role still fails. The map's keydown listener is
   attached on the DOM element beside the non-passive wheel listener, because
   the companion `no-noninteractive-element-interactions` rule has no role
   allowlist. The keyboard behaviour itself is covered by
   `apps/web/src/LocationPickerMap.test.tsx`.
2. **Pointer handlers are invisible to the preset.** `no-static-element-interactions`
   and `no-noninteractive-element-interactions` look only at mouse and keyboard
   handlers, so a `<div role="img">` with `onPointerDown` passed lint while
   being pointer-only. A `no-restricted-syntax` selector now rejects a
   non-SVG element that pairs `role="img"` with a pointer handler. SVG charts
   keep `role="img"` and hover handlers because they are read-only graphics
   whose keyboard alternative is issue #325.

## Data-model and API impact

None. The change is lint configuration, markup fixes and test updates.
