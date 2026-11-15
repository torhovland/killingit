/** The background and stroke classes that colour one series. */
interface SeriesClass {
  /** The legend swatch's background. */
  background: string;
  /** The line's stroke. */
  stroke: string;
}

/** Distinct line classes so several measures in one unit stay readable. */
const SERIES_CLASSES: readonly SeriesClass[] = [
  { stroke: "stroke-primary", background: "bg-primary" },
  { stroke: "stroke-foreground", background: "bg-foreground" },
  {
    stroke: "stroke-form-fresh-line",
    background: "bg-form-fresh-line",
  },
  { stroke: "stroke-destructive", background: "bg-destructive" },
];

/**
 * The classes for the series at `index`, wrapping around the shared palette so
 * a chart with more lines than colours reuses them in order. An index past a
 * custom palette falls back to its first entry, and an empty palette has no
 * classes at all.
 */
export function seriesClass(
  index: number,
  palette: readonly SeriesClass[] = SERIES_CLASSES,
): SeriesClass | undefined {
  return palette[index % palette.length] ?? palette[0];
}
