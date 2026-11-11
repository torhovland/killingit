# ADR 0027: Own Tailwind primitives with `cn()`

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** torhovland
- **Related:** `docs/specs/web-component-library.md`

## Context

The web app repeated the primary button, secondary button, input and card class
strings across dozens of pages. The copies had already drifted: disabled
opacity varied between 40, 50 and 60, text size was sometimes explicit and
sometimes inherited, and some fields were full width while their neighbours were
not. AGENTS.md described a component library under `components/`, shadcn/ui
source and a `cn()` helper, none of which existed.

The app needs a small set of controls, not a design system. It has no dialogs
built on Radix, no light theme, and no third-party component dependency.

## Decision

- Add `clsx` and `tailwind-merge` behind one `cn()` helper, so a caller's
  `className` overrides a primitive's default predictably.
- Own the primitives in `apps/web/src/components/`: `Button`, `Input`,
  `Textarea`, `Select`, `Card` and `HiddenFileInput`, plus `SubmitButton` on top
  of `Button`.
- Express the looks as `variant` and `size` props with the app's existing
  tokens; keep `className` for layout and deliberate overrides.
- Keep page components flat in `apps/web/src/` and move only shared primitives
  into `components/`.

## Alternatives considered

- **Keep class strings inline.** Rejected: the copies drift, and a global
  change has to be repeated page by page.
- **Adopt shadcn/ui and Radix.** Rejected for now: it adds a dependency and
  generated component set for controls the app already builds itself, and the
  app uses no Radix primitives. The primitive layout follows shadcn's
  source-owned approach without the dependency.
- **CSS modules or a CSS-in-JS layer.** Rejected: it would replace the token
  and utility convention the rest of the app already follows.

## Consequences

- A control's look is defined once; a page passes semantics and layout.
- `tailwind-merge` resolves conflicting utilities, so a page can tighten one
  class without forking the primitive.
- The primitives are a new place to look when a control changes, and their API
  must stay small enough to read in one file.
- A one-off control with unique styling may remain a plain element, but the
  repeated strings now have one home.
