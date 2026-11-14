import type { ApiErrorCode } from "@killingit/shared";

/**
 * The status the API answers with when a provider rejects the athlete's own
 * credential. It is deliberately not 401: the session is still valid, and the
 * web client renews and retries a 401 as an expired session. A 409 reports that
 * the stored connection conflicts with the request, so the athlete has to fix
 * the connection instead. See `docs/specs/api-errors.md`.
 */
export const CREDENTIAL_FAILURE_STATUS = 409;

export interface UpstreamErrorOptions {
  cause?: unknown;
  /**
   * The stable API code to report. A provider class sets one when the failure
   * is not described by the status alone, such as a rejected credential.
   */
  code?: ApiErrorCode;
}

/**
 * An error raised by an upstream dependency, carrying the HTTP status the API
 * answers with. A provider reports a status when it answered the request, such
 * as 429 for rate limiting; a rejected credential is translated to
 * {@link CREDENTIAL_FAILURE_STATUS} by the provider's own error class so no
 * upstream 401 is mistaken for an expired session. The status is optional
 * because a failure such as a timeout has no answer of its own; the shared
 * mapper then falls back to 503.
 */
export class UpstreamError extends Error {
  readonly code: ApiErrorCode | undefined;

  constructor(
    message: string,
    readonly status?: number,
    options: UpstreamErrorOptions = {},
  ) {
    super(message, options);
    this.name = "UpstreamError";
    this.code = options.code;
  }
}

/**
 * An upstream failure caused by the API's own configuration, such as a stored
 * credential that cannot be decrypted. It answers like any other upstream
 * error, but the mapper logs it as well, because the athlete only ever sees the
 * message.
 */
export class UpstreamConfigurationError extends UpstreamError {}
