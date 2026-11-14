# ADR 0049: One SVG path builder and one rounding helper for the charts

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** `docs/specs/fitness-page.md`, issue #319

## Context

The fitness charts each turned a series into SVG path data by hand.
`chartGeometry.ts` had `linePath` for a series without gaps and `nullAwarePath`
for one with missing days, while `BodyChart.tsx` carried its own `targetPath`
and `metricPath` that repeated the same `M`/`L` assembly for dated points.
Three private `round` helpers rounded the coordinates: two to a tenth and one,
in `DailyHealthCharts.tsx`, to a hundredth. The copies had already started to
differ in how they handled a skipped day: the shared helpers broke the line,
the body chart joined across the gap.

## Decision

- `chartGeometry.ts` owns one path builder, `chartPath(points, scale)`. A point
  carries its day index and its value; a null value starts a new subpath, and
  a point that is simply absent is joined across, so both behaviours are
  explicit in the point list rather than in a second builder.
- `linePath` and `nullAwarePath` stay as thin conveniences that shape a value
  array into points and call `chartPath`; they no longer assemble path strings.
- `datedPathPoints(points, dayIndex, range)` maps a dated series onto the days
  the chart knows and limits it to an inclusive index range, so `BodyChart`
  passes points to `chartPath` instead of carrying path code.
- `roundChartValue` is the one coordinate rounding helper: a tenth of a
  viewBox unit, which is finer than a rendered pixel. The hundredth in the
  sleep chart was not visible and only lengthened the path strings.
- The stacked sleep area keeps its own area assembly, because a closed
  forward-and-back shape is not a polyline, but it uses the shared rounding.

## Alternatives considered

- **Keep `linePath` and `nullAwarePath` and add a third builder for dated
  points.** Rejected: that is the duplication the issue reports.
- **Make `nullAwarePath` fill gaps with nulls in the body chart.** Rejected:
  the coach's diet targets are sparse by design, and a dotted line broken at
  every period would read as separate marks rather than one trend.
- **Round to a hundredth everywhere.** Rejected: the extra digit is invisible
  at the chart's rendered size and doubles the path text.
- **Keep a display-specific rounding helper in `BodyChart`.** Rejected: the
  tooltip's target weight and body fat are the same kind of chart value, and
  one helper keeps their precision from drifting from the plotted line.

## Consequences

- A chart supplies points, not path strings; the `M`/`L` assembly, the gap
  behaviour and the coordinate precision live in one module.
- `datedPathPoints` names the past/future split at the call site
  (`{ to: split }`, `{ from: split }`) instead of a `"past" | "future"` flag.
- The path helpers are covered by unit tests in `chartGeometry.test.ts`,
  including a skipped day, a null break and the rounding.
- A new chart has to shape its data into points, which is a small cost next to
  writing a fourth path builder.
