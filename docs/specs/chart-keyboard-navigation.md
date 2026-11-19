# Spec: Chart keyboard navigation

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** issue #325, ADR 0051, `docs/specs/fitness-page.md`,
  `docs/specs/accessibility-lint.md`, `docs/specs/web-interaction-tests.md`,
  `AGENTS.md`.

## Goal

Every value a chart shows on hover must be reachable without a pointer. Before
this, `useChartHover` handled only `onPointerMove`, so a keyboard or
screen-reader user could not read any day's numbers, activities or planned
workout on the Fitness page, and the same was true of the Costs page's bar
chart.

## Scope

### In scope

1. A shared keyboard cursor over a chart's positions,
   `useChartKeyboard(count)` in `apps/web/src/charts/useChartKeyboard.ts`: the chart is
   one tab stop, the left and right arrow keys move the cursor, Home and End
   jump to the first and last position, and Escape clears it.
2. `useChartHover` composes the cursor and reuses the existing hover marker and
   hover card, so `ChartFrame` and therefore every dated chart (fitness,
   estimated threshold, body, recovery and sleep) gets the behaviour at once.
3. The Costs page's `CostBarChart` uses the same cursor over its bars.
4. One polite live region per chart that announces the keyboard-moved position's
   card content, and a visually hidden instruction the chart's `<svg>` points at
   with `aria-describedby`.
5. A lint rule that fails an `<svg>` that carries a pointer handler without also
   being a tab stop and handling keys.

### Out of scope

- A visually hidden data table per chart, and a full data-list alternative for
  screen readers. The hover card already carries the numbers, activities and
  planned workout; announcing it reuses that content instead of a second copy of
  the data.
- Tabbing to individual data points. A chart is one tab stop; the arrow keys
  move inside it, so a page with six charts does not add thirty tab stops.
- Keyboard hover for the calorie chart, which has no hover card today (`<title>`
  tooltips only) and is not a pointer surface. It stays out of the tab order.
- Chart zooming, brushing or a data-point table.

## Design

### Keys

- **Left and right arrows** step one position, wrapping the ends by clamping.
  They are used instead of up and down because up and down scroll the page
  vertically, and a chart must not freeze page scrolling just to read a day.
  Left and right do not scroll a vertically laid-out page.
- **Home and End** jump to the first and last position, the usual widget
  convention. The chart owns those keys while it has focus, so it calls
  `preventDefault()`.
- **Escape** clears the selection, matching a popup's Escape. Blur clears it too,
  so a card does not linger after the athlete tabs on.
- A pointer move clears the keyboard selection, so the pointer takes over
  without a stale card, and the live region never announces pointer movement.

### Announcement

- The chart's `<svg>` is `tabIndex={0}` with `role="img"` and its existing
  accessible name, plus `aria-describedby` pointing at a visually hidden
  instruction (`CHART_KEYBOARD_HINT`).
- A `role="status" aria-live="polite"` region renders the same card content the
  pointer hover shows, but only for the keyboard selection. The region is
  mounted from the start, so a screen reader picks up each change; it empties
  when Escape or blur clears the selection.
- The card is not announced while a pointer moves, so dragging across a chart
  does not read every day aloud.
- `useChartHover` therefore returns `announced` separately from `hovered`:
  `hovered` is what the marker and card draw (pointer or keyboard), `announced`
  is `null` unless the keyboard moved the cursor.
- A chart without a hover card still announces the day, through the formatted
  date, so a bare `ChartFrame` is not silent.
- The chart keeps `role="img"` while focusable: it is a read-only graphic with
  its own key handling, and the values live in the live region, not in the SVG's
  children. `docs/specs/accessibility-lint.md` explains the allowlist entry.

### Pitfalls

- `useChartKeyboard` returns handlers that replace the ones `ChartFrame` used
  before; pointer behaviour is unchanged (`onPointerMove`, `onPointerDown` and
  `onPointerLeave` still drive the marker and card).
- Nothing is hovered until the first keyboard move, so a keyboard user does not
  hear a day they did not ask for on focus.

## Acceptance criteria

1. Tab reaches a chart once, and the chart's accessible description names the
   keyboard controls.
2. Right and Left step through the days, Home and End jump to the ends, and the
   hover marker and card follow the keyboard exactly as they follow the pointer.
3. Escape and blur clear the marker, the card and the announcement.
4. The live region contains the moved-to day and its values, and does not update
   while a pointer moves.
5. Pointer hovering and tapping still work.
6. The cost bar chart's bars are reachable the same way.
7. `bun run lint` rejects an `<svg>` that has a pointer handler but no
   `tabIndex` or no `onKeyDown`.
8. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test` and
   `bun run check:unused` pass.

## Testing

- `apps/web/src/charts/useChartHover.test.tsx` drives the shared hook through a small
  harness: Tab focus, Right/Left, Home/End, Escape, blur, the announced text and
  a pointer move that stays silent.
- `apps/web/src/charts/ChartFrame.test.tsx` proves the shared frame is one tab stop
  with the keyboard description and announces the hovered day.
- `apps/web/src/fitness/FitnessChart.test.tsx` proves a real chart wires the cursor: the
  keyboard-selected day's card content appears and matches `FitnessDayTooltip`.
- `apps/web/src/costs/CostBarChart.test.tsx` proves the bar chart announces a
  bar's total.

## Data model and API impact

None. The change is web interaction, lint configuration, tests and docs.
