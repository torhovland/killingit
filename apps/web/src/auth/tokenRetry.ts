import { TimeoutError } from "@auth0/auth0-react";

/**
 * Raised when the SDK's silent token renewal timed out twice: the cross-tab
 * renewal lock stayed busy longer than its five-second budget each time. The
 * session itself is healthy, so the athlete is not signed out; the message is
 * shown as a retryable failure. See `docs/specs/web-token-renewal.md`.
 */
class TokenRenewalTimeoutError extends Error {
  constructor(cause: unknown) {
    super(
      "Renewing your session timed out. Check your connection and try again.",
      { cause },
    );
    this.name = "TokenRenewalTimeoutError";
  }
}

/**
 * Runs one silent token request, retrying once when the SDK could not acquire
 * its cross-tab renewal lock within its five-second budget. The timeout means
 * another renewal (usually another tab, or a forced refresh) was still running;
 * by the retry it has either populated the token cache or released the lock, so
 * the second attempt normally resolves immediately. Any other failure is not
 * retried. A second timeout becomes a {@link TokenRenewalTimeoutError}.
 */
export async function requestTokenWithRetry<T>(
  request: () => Promise<T>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof TimeoutError)) {
      throw error;
    }
    return retryTimedOutRequest(request);
  }
}

/** The one retry of {@link requestTokenWithRetry}; owning it keeps each small. */
async function retryTimedOutRequest<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof TimeoutError) {
      throw new TokenRenewalTimeoutError(error);
    }
    throw error;
  }
}
