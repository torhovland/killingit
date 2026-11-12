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
  const failureStatus = status >= 400 && status <= 599 ? status : 503;
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

function codeForStatus(status: number): ApiErrorCode {
  return (
    CODE_BY_STATUS[status] ??
    (status >= 500 ? "service_unavailable" : "bad_request")
  );
}
