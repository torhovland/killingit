# Spec: Accessibility lint

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** ADR 0041, issue #305, `docs/specs/web-component-library.md`,
  `docs/specs/web-interaction-tests.md`, `AGENTS.md`.

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
  data exposed to screen readers, keyboard operation of the location map, sort
  announcements, and a menu primitive. Those stay in their own a11y issues
  (#324–#328).
- Running the rules over non-React code (the API, scripts, shared package) and
  over the Playwright config. Only the web app renders JSX.

## Acceptance criteria

1. `bun run lint` passes on a clean tree with the plugin enabled.
2. Adding an `<img>` without `alt`, a `<label>` without a control, or an
   `onClick` on a non-interactive `<div>` makes `bun run lint` fail, so CI
   catches the regression.
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

## Data-model and API impact

None. The change is lint configuration, markup fixes and test updates.
