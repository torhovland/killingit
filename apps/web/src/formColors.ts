import type { FormInterpretation } from "@killingit/shared";

/** Text colour for a TSB interpretation, matching the chart zone fill. */
export const FORM_TEXT_CLASSES: Record<FormInterpretation, string> = {
  risk: "font-medium text-form-risk",
  productive: "font-medium text-form-productive",
  maintaining: "text-form-maintaining",
  fresh: "text-form-fresh",
  detraining: "text-form-detraining",
};

/**
 * Zone fill for the fitness chart. Painted solid on the white plot so each band
 * matches its legend swatch exactly.
 */
export const FORM_FILL_CLASSES: Record<FormInterpretation, string> = {
  risk: "fill-form-risk",
  productive: "fill-form-productive",
  maintaining: "fill-form-maintaining",
  fresh: "fill-form-fresh",
  detraining: "fill-form-detraining",
};

/** Swatch for the chart legend. */
export const FORM_SWATCH_CLASSES: Record<FormInterpretation, string> = {
  risk: "bg-form-risk",
  productive: "bg-form-productive",
  maintaining: "bg-form-maintaining",
  fresh: "bg-form-fresh",
  detraining: "bg-form-detraining",
};
