/**
 * An error raised by an upstream dependency, carrying the HTTP status the API
 * answers with. A provider reports a status when it answered the request, such
 * as 401 for rejected credentials or 429 for rate limiting. The status is
 * optional because a failure such as a timeout has no answer of its own; the
 * shared mapper then falls back to 503.
 */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "UpstreamError";
  }
}

/**
 * An upstream failure caused by the API's own configuration, such as a stored
 * credential that cannot be decrypted. It answers like any other upstream
 * error, but the mapper logs it as well, because the athlete only ever sees the
 * message.
 */
export class UpstreamConfigurationError extends UpstreamError {}
