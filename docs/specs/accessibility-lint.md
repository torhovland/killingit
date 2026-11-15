# Spec: Accessibility lint

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** ADR 0041, issues #305, #324 and #325,
  `docs/specs/web-component-library.md`, `docs/specs/web-interaction-tests.md`,
  `docs/specs/chart-keyboard-navigation.md`, `AGENTS.md`.

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
  data exposed to screen readers, sort announcements, and menus. Focus traps are
  covered by the `Modal` tests, the chart keyboard path (#325) by
  `docs/specs/chart-keyboard-navigation.md`, the model table's sort
  announcements (#326) by `apps/web/src/llm/ModelTable.test.tsx`, and the menu
  disclosure (#327) by `apps/web/src/components/Menu.test.tsx` plus the account
  menu's journey test. The location map's keyboard path (#324) is implemented
  and guarded by interaction tests rather than by a lint rule, because whether
  keys actually move the map is behaviour, not JSX.
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
   `apps/web/src/settings/LocationPickerMap.test.tsx`.
2. **Pointer handlers are invisible to the preset.** `no-static-element-interactions`
   and `no-noninteractive-element-interactions` look only at mouse and keyboard
   handlers, so a `<div role="img">` with `onPointerDown` passed lint while
   being pointer-only. A `no-restricted-syntax` selector now rejects a
   non-SVG element that pairs `role="img"` with a pointer handler.

## Follow-up checks from issue #325

The chart a11y fix (#325) added the keyboard path the charts were missing and
closed the lint gap that let a pointer-only chart through:

1. **A focusable `role="img"`.** A chart is a read-only graphic that is also one
   keyboard stop, so `no-noninteractive-tabindex` now names `img` in its role
   allowlist beside `application`; every other non-interactive role still
   fails. The chart keeps `role="img"`, its `aria-label`, and an
   `aria-describedby` instruction; the values it announces come from its polite
   live region rather than from the graphic's children. See
   `docs/specs/chart-keyboard-navigation.md` and ADR 0051.
2. **A pointer-only `<svg>`.** Two `no-restricted-syntax` selectors now fail an
   `<svg>` that has a pointer handler without `tabIndex`, and one without
   `onKeyDown`. A chart cannot regress to hover-only, and the fix is shared
   through `ChartFrame` and `useChartKeyboard` rather than per chart. The
   location map's `<div>` is out of these selectors' scope because its keydown
   listener is attached on the DOM element, and its behaviour is covered by
   `apps/web/src/settings/LocationPickerMap.test.tsx`.

## Data-model and API impact

None. The change is lint configuration, markup fixes and test updates.
