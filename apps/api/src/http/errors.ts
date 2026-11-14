import type { ApiErrorCode, ApiErrorResponse } from "@killingit/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** The code reported for each failure status the API uses. */
const CODE_BY_STATUS: Partial<Record<number, ApiErrorCode>> = {
  400: "bad_request",
  401: "unauthorized",
  402: "payment_required",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "validation_failed",
  426: "api_version_mismatch",
  429: "too_many_requests",
  500: "internal_error",
  502: "bad_gateway",
  503: "service_unavailable",
};

/**
 * An error whose message is written for the athlete. `athleteFailureMessage`
 * shows one as it is, because it names a change the athlete can make; every
 * other failure is an internal detail that is logged instead. See ADR 0038.
 */
export abstract class AthleteFacingError extends Error {}

/**
 * A failure from a third-party service the API depends on. The failure owns the
 * status — and, when the provider needs one, the code — it is reported with, so
 * a route hands its whole error path to `respondUpstreamError` instead of
 * matching provider classes of its own. A subclass that does not name a status
 * is reported as a service failure.
 */
export abstract class UpstreamError extends AthleteFacingError {
  readonly status: number;
  readonly code: ApiErrorCode | undefined;

  constructor(
    message: string,
    options: {
      status?: number | undefined;
      code?: ApiErrorCode | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message, options);
    this.status = options.status ?? 503;
    this.code = options.code;
  }
}

/**
 * Answers with the shared error contract. Routes use one of the named helpers
 * below; `apiError` is for a status that comes from an upstream provider.
 */
export function apiError(
  c: Context,
  status: number,
  message: string,
  options: { code?: ApiErrorCode; details?: unknown } = {},
) {
  // A provider can report a status outside the failure range. Keep the
  // response a failure rather than echoing an impossible 2xx or 3xx.
  const failureStatus = reportableStatus(status);
  const body: ApiErrorResponse = {
    error: {
      code: options.code ?? codeForStatus(failureStatus),
      message,
      ...(options.details === undefined ? {} : { details: options.details }),
    },
  };
  return c.json(body, failureStatus as ContentfulStatusCode);
}

/** A request the client can fix by changing what it sent. */
export function badRequest(c: Context, message: string, details?: unknown) {
  return apiError(c, 400, message, details === undefined ? {} : { details });
}

/**
 * A request whose body, path or query failed schema validation. The Zod
 * issues are included under `details.issues`, so a client can point at the
 * field that is wrong without parsing the message.
 */
export function validationFailed(
  c: Context,
  error: { readonly issues: readonly unknown[] },
  message = "The request is not valid",
) {
  return apiError(c, 400, message, {
    code: "validation_failed",
    details: { issues: error.issues },
  });
}

/** A missing or invalid credential, or a provider that needs connecting. */
export function unauthorized(c: Context, message = "Unauthorized") {
  return apiError(c, 401, message);
}

/** An authenticated account without the role this route requires. */
export function forbidden(c: Context, message = "Forbidden") {
  return apiError(c, 403, message);
}

/** A requested resource that does not exist for this account. */
export function notFound(c: Context, message: string) {
  return apiError(c, 404, message);
}

/** A request that conflicts with existing state, such as a duplicate. */
export function conflict(c: Context, message: string) {
  return apiError(c, 409, message);
}

/** An upstream service answered, but with a failure. */
export function badGateway(c: Context, message: string) {
  return apiError(c, 502, message);
}

/** A dependency is unavailable, so the API cannot answer right now. */
export function serviceUnavailable(
  c: Context,
  message = "Service Unavailable",
) {
  return apiError(c, 503, message);
}

/**
 * Answers a request that failed on a third-party service, with the status and
 * code the error carries. Only a service failure is logged: a 4xx asks the
 * athlete to fix their connection, which is an expected answer rather than an
 * incident. An error of any other kind is logged with the caller's label and
 * reported as unavailable, so a route never guesses a status from an
 * unexpected failure.
 */
export function respondUpstreamError(
  c: Context,
  err: unknown,
  logLabel = "[upstream]",
): Response {
  if (!(err instanceof UpstreamError)) {
    console.error(`${logLabel}:`, err);
    return serviceUnavailable(c);
  }
  // A provider can report a status outside the failure range; `apiError`
  // reports it as unavailable, so the log decision follows that status too.
  const status = reportableStatus(err.status);
  if (status >= 500) {
    console.error(`${logLabel}:`, err);
  }
  return apiError(
    c,
    status,
    err.message,
    err.code === undefined ? {} : { code: err.code },
  );
}

/**
 * The text an athlete sees for a caught failure: the error's own message when it
 * was written for them, and the caller's fallback otherwise. A caller that logs
 * the failure itself uses this; one that does not uses `athleteFailureMessage`.
 */
export function athleteFacingMessage(err: unknown, fallback: string): string {
  return err instanceof AthleteFacingError ? err.message : fallback;
}

/**
 * The text an athlete sees for a failure outside the error contract — a stored
 * `analysisError`, or the message of a response that is not a provider failure.
 * A failure written for the athlete keeps its own message; any other failure is
 * an internal detail, so it is logged under `logLabel` and the caller's fallback
 * sentence is shown instead. The logging matches `respondUpstreamError`: a
 * provider `4xx` and an athlete-facing answer are expected, while a service
 * failure and every internal failure are incidents. See ADR 0038.
 */
export function athleteFailureMessage(
  err: unknown,
  options: { fallback: string; logLabel: string },
): string {
  if (!(err instanceof AthleteFacingError)) {
    console.error(`${options.logLabel}:`, err);
    return options.fallback;
  }
  if (err instanceof UpstreamError && reportableStatus(err.status) >= 500) {
    console.error(`${options.logLabel}:`, err);
  }
  return err.message;
}

function reportableStatus(status: number): number {
  return status >= 400 && status <= 599 ? status : 503;
}

function codeForStatus(status: number): ApiErrorCode {
  return (
    CODE_BY_STATUS[status] ??
    (status >= 500 ? "service_unavailable" : "bad_request")
  );
}
