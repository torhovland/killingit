/** The instruction every rejected plan ends with. */
const REGENERATE_INSTRUCTION = "Please regenerate the plan.";

/**
 * A plan the coach returned that cannot be stored, such as a season that does
 * not cover today or a tomorrow session outside a planned week. The message
 * names the fault and owns the shared instruction to regenerate, so every plan
 * check reports the same sentence. It is deliberately not an
 * `AthleteFacingError`: a model fault is not the athlete's to repair, so the
 * run keeps its generic reason (ADR 0038). See
 * `docs/specs/plan-validation-errors.md`.
 */
export class PlanValidationError extends Error {
  constructor(message: string) {
    super(`${message} ${REGENERATE_INSTRUCTION}`);
    this.name = "PlanValidationError";
  }
}
