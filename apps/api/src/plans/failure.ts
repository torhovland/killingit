import { athleteFacingMessage } from "../http/errors.js";

/** The reason reported when a plan run ended on an internal fault. */
export const PLAN_FAILED_MESSAGE =
  "The plan could not be generated. Try again.";

/**
 * The athlete-facing reason for a failed plan run, stored on its generation row
 * and shown in the plan section. A provider failure or a retired model keeps its
 * own message, because it names the fix; any other error is an internal detail
 * that the run's logger records. See ADR 0038.
 */
export function planFailureMessage(err: unknown): string {
  return athleteFacingMessage(err, PLAN_FAILED_MESSAGE);
}
