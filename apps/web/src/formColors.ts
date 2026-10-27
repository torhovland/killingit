import type { FormInterpretation } from "@killingit/shared";

/** Text colour for a TSB interpretation, matching the chart's zone colours. */
export const FORM_TEXT_CLASSES: Record<FormInterpretation, string> = {
  risk: "font-medium text-form-risk",
  productive: "font-medium text-form-productive",
  maintaining: "text-form-maintaining",
  fresh: "text-form-fresh",
  detraining: "text-form-detraining",
};

/**
 * Zone band fill for the fitness chart: the zone colour kept pale on the white
 * plot so the coloured TSB line stays distinct.
 */
export const FORM_FILL_CLASSES: Record<FormInterpretation, string> = {
  risk: "fill-form-risk/25",
  productive: "fill-form-productive/25",
  maintaining: "fill-form-maintaining/25",
  fresh: "fill-form-fresh/25",
  detraining: "fill-form-detraining/25",
};

/** The solid TSB line, coloured by the zone it is in. */
export const FORM_STROKE_CLASSES: Record<FormInterpretation, string> = {
  risk: "stroke-form-risk-line",
  productive: "stroke-form-productive-line",
  maintaining: "stroke-form-maintaining-line",
  fresh: "stroke-form-fresh-line",
  detraining: "stroke-form-detraining-line",
};

/** Swatch for the chart legend. */
export const FORM_SWATCH_CLASSES: Record<FormInterpretation, string> = {
  risk: "bg-form-risk",
  productive: "bg-form-productive",
  maintaining: "bg-form-maintaining",
  fresh: "bg-form-fresh",
  detraining: "bg-form-detraining",
};
