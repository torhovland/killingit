# ADR 0041: Accessibility lint for the web app

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** `docs/specs/accessibility-lint.md`, issue #305, issue #172

## Context

The web app's accessibility work so far was driven by review and by individual
issues: the modal already traps and restores focus, primitives own their
dialog and field markup, and interaction tests exercise keyboard behaviour. No
lint rule looked at the JSX itself, so a missing `alt`, a detached label or a
click handler on a plain `<div>` reached the repository unnoticed and was only
found when someone happened to inspect the page.

The frontend stack is React with TypeScript and a local component library. Its
lint gate is ESLint's flat config with TypeScript's type-aware presets, the
React hooks plugin and one local rule. Adding a JSX accessibility plugin is a
configuration change to that existing gate, so every file, developer and CI
job picks it up without a new command.

## Decision

- Add `eslint-plugin-jsx-a11y` as a root dev dependency and apply its
  `flatConfigs.recommended` preset to the web app's TypeScript and JSX files.
  The recommended preset is the plugin's maintained baseline; the stricter
  preset is not enabled because its extra rules forbid patterns the app uses
  deliberately, such as a custom interactive element that already implements
  the keyboard handling.
- Keep the preset's rules as errors. A barrier should fail the build, not warn
  in a log nobody reads.
- Declare the `Input`, `Textarea` and `Select` primitives as the native
  controls they render through the plugin's `components` setting. The
  primitives forward all props to a native element, so a wrapping `<label>` is
  genuinely associated; without the mapping the rule cannot see through the
  wrapper and reports a false positive.
- Fix the reported findings in the markup instead of disabling a rule:
  redundant `alt` wording, the modal backdrop's click target, and the label
  association above.

## Alternatives considered

- **Add `eslint-plugin-jsx-a11y` only to the web workspace's own lint.** The
  repository runs one root ESLint invocation; a second config would drift from
  it and CI would need a separate step. Rejected.
- **Give every labelled field an explicit `id`/`htmlFor` pair.** Valid, but it
  repeats ids at seven call sites and none of them needs an id for anything
  else. The plugin's component mapping expresses the same fact once. An explicit
  id remains the right choice when a label and control cannot be nested.
- **Suppress the backdrop finding with an `eslint-disable` comment.** It would
  silence the rule exactly where it found a real gap — an unlabelled click
  target — and the repository forbids new disables as a way to pass a check.
  Rejected.
- **Adopt the strict preset.** It adds rules such as requiring a clickable
  element to also be focusable in every case, which duplicates decisions the
  separate a11y issues make about custom widgets. Revisit if those land.

## Consequences

- `bun run lint` now fails on the mechanical barriers the preset covers, and CI
  runs it unchanged.
- The modal's backdrop is a labelled button in the tab order's shadow: it is
  rendered outside the panel, so the focus trap keeps Tab inside the dialog and
  Escape still closes it. A screen reader inside the modal dialog does not
  reach it.
- Static rules cannot judge focus management, chart alternatives or keyboard
  operation of a map; those remain tracked by issues #324–#328.
- A future custom control that is genuinely interactive but not a native
  element needs either the right ARIA role and keyboard handling or a
  deliberate rule option; the preset's errors make that a conscious decision.
