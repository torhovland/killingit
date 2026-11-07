/**
 * Fills for the stacked cost bars. Every series uses the light blue of the
 * Fitness page's REM-sleep band, with descending opacity so the stack stays
 * readable when several models or prompt types contributed to a period.
 */
export const COST_SERIES_FILL = [
  "fill-form-fresh",
  "fill-form-fresh/70",
  "fill-form-fresh/50",
  "fill-form-fresh/35",
  "fill-form-fresh/25",
  "fill-form-fresh/18",
  "fill-form-fresh/12",
  "fill-form-fresh/8",
] as const;

/** Swatches for the cost chart legend, matching the bar fills. */
export const COST_SERIES_SWATCH = [
  "bg-form-fresh",
  "bg-form-fresh/70",
  "bg-form-fresh/50",
  "bg-form-fresh/35",
  "bg-form-fresh/25",
  "bg-form-fresh/18",
  "bg-form-fresh/12",
  "bg-form-fresh/8",
] as const;
