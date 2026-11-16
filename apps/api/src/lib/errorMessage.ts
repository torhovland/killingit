/**
 * The message to report for a thrown value. An `Error` carries its own message;
 * anything else (a string, a rejected SDK value, a thrown object) is stringified
 * so a log line never loses the failure. The web app's `reportError` keeps the
 * same contract for the browser.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
