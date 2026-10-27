import type { FormInterpretation } from "@killingit/shared";

/** Text colour for a TSB interpretation, matching the chart zone fill. */
export const FORM_TEXT_CLASSES: Record<FormInterpretation, string> = {
  risk: "font-medium text-form-risk",
  productive: "font-medium text-form-productive",
  maintaining: "text-form-maintaining",
  fresh: "text-form-fresh",
  detraining: "text-form-detraining",
};

/** Zone fill for the fitness chart, soft enough for lines to stay readable. */
export const FORM_FILL_CLASSES: Record<FormInterpretation, string> = {
  risk: "fill-form-risk/20",
  productive: "fill-form-productive/20",
  maintaining: "fill-form-maintaining/20",
  fresh: "fill-form-fresh/20",
  detraining: "fill-form-detraining/20",
};

/** Swatch for the chart legend. */
export const FORM_SWATCH_CLASSES: Record<FormInterpretation, string> = {
  risk: "bg-form-risk",
  productive: "bg-form-productive",
  maintaining: "bg-form-maintaining",
  fresh: "bg-form-fresh",
  detraining: "bg-form-detraining",
};
