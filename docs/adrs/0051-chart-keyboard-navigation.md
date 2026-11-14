# ADR 0051: Charts are one keyboard tab stop with a polite live region

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** `docs/specs/chart-keyboard-navigation.md`,
  `docs/specs/fitness-page.md`, `docs/specs/accessibility-lint.md`, ADR 0041,
  issue #325

## Context

`useChartHover` followed only `onPointerMove`, and `ChartFrame` passed those
handlers to the chart's `<svg>`. The fitness, estimated-threshold, body,
recovery and sleep charts therefore showed a day's load, threshold, weight or
sleep values only under a pointer, and the Costs page's bar chart was
pointer-only in the same way. A keyboard or screen-reader user could reach the
page and the chart's accessible name but not a single number.

The charts already share one frame, so the fix belongs there. The two candidate
solutions the issue offers are a focusable SVG with key handling, or a visually
hidden data table per chart.

## Decision

- **Keyboard navigation over a hidden data table.** The chart is one tab stop;
  the left and right arrow keys move the hover cursor, Home and End jump to the
  first and last position, and Escape or blur clears it. The marker and the
  existing hover card follow the cursor, so there is one representation of a
  day's values and nothing can drift between a table and the card.
- **A shared cursor, not per-chart code.** `useChartKeyboard(count)` owns the
  key handling and the safe keys. `useChartHover` composes it for `ChartFrame`,
  which every dated chart uses; `CostBarChart` uses it directly over its bars.
- **Left and right, Home and End, Escape.** Up and down scroll the page, so
  binding them would trap vertical scrolling whenever a chart has focus. Left
  and right do not scroll a vertical page. Home and End are the widget
  convention for the ends and are `preventDefault`ed while the chart is focused.
- **A polite live region that reuses the hover card.** `ChartFrame` renders the
  same `tooltip` render-prop into `role="status" aria-live="polite"` for the
  keyboard selection only, so a screen reader hears the day and its values. The
  region exists before any content changes, which is what makes a live region
  reliable. Pointer movement clears the keyboard cursor and never writes to the
  region, so dragging across a chart does not read every day aloud.
- **`role="img"` stays.** A chart is a read-only graphic, not a form control;
  `slider` or `application` would misdescribe it and, for `application`, cost
  the user browse mode for a graphic. The focusable read-only image is named by
  its existing `aria-label` and describes its controls through
  `aria-describedby`. `jsx-a11y/no-noninteractive-tabindex` names `img` in its
  role allowlist for that case, next to the `application` entry the location map
  needed.

## Alternatives considered

- **A visually hidden data table per chart.** Rejected: it is a second copy of
  every value, so the card and the table drift the first time a series changes,
  and each chart has to hand-maintain its columns. It also tells a screen reader
  the same numbers the card already carries.
- **Tabbing to each data point.** Rejected: a Fitness page with six charts would
  add hundreds of tab stops, and the chart's own keys already cover the same
  ground.
- **Up and down arrows.** Rejected: they would either scroll the page and move
  the cursor at once, or require `preventDefault` and take vertical scrolling
  away from a long page.
- **`role="application"` or `role="slider"`.** Rejected: `application` forces
  screen-reader users out of browse mode for a read-only graphic, and `slider`
  promises an adjustable value the chart does not have.
- **Announcing every pointer hover.** Rejected: a pointer sweeping the plot
  would read every day in between, which is noise rather than information.
- **A cursor that starts on the first day when the chart is focused.** Rejected:
  focusing a chart to read its title should not immediately announce a day the
  user did not ask for.

## Consequences

- A chart gets keyboard access by using `ChartFrame`; a chart that draws its own
  SVG has to use `useChartKeyboard` and render the instruction and the live
  region, as `CostBarChart` does.
- `jsx-a11y/no-noninteractive-tabindex` now allows `img` as well as
  `application`; every other non-interactive role still fails.
- A `no-restricted-syntax` rule fails an `<svg>` that has a pointer handler
  without `tabIndex` and `onKeyDown`, so the pointer-only chart cannot come
  back. The location map's `<div>` is out of that rule's scope because its
  keydown listener lives on the DOM element; its behaviour is covered by
  interaction tests instead.
- The live region duplicates the card's DOM while the keyboard cursor is
  active, so a test that queries a card by test id has to expect the announced
  copy as well.
- The interaction tests in `useChartHover.test.tsx`, `ChartFrame.test.tsx`,
  `FitnessChart.test.tsx` and `CostBarChart.test.tsx` cover the keys,
  Escape and blur, the announced text and the silence during pointer movement.
