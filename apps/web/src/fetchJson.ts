import { apiErrorResponseSchema, type ApiErrorCode } from "@killingit/shared";
import * as Sentry from "@sentry/react";
import { reportApiOutdated } from "./apiVersion";

/**
 * A non-2xx API response. Callers (and `reportError`) can tell expected client
 * failures (4xx: bad credentials, rate limiting, expired session) apart from
 * server-side faults (5xx). When the API answered with its error contract,
 * `message` is the server's display message and `code`/`details` carry its
 * structured context.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode | null;
  readonly details: unknown;

  constructor(
    message: string,
    readonly status: number,
    options?: { cause?: unknown; code?: ApiErrorCode; details?: unknown },
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ApiError";
    this.code = options?.code ?? null;
    this.details = options?.details ?? null;
  }
}

/**
 * Third-party connection failures. The session is still valid, so the client
 * must not renew the token and retry; the athlete has to fix the connection in
 * Settings. See `docs/specs/third-party-credential-failures.md`.
 */
const CREDENTIAL_FAILURE_CODES: ReadonlySet<ApiErrorCode> = new Set([
  "garmin_auth_failed",
  "llm_key_invalid",
]);

/** Whether a failure asks the athlete to reconnect a third-party service. */
export function isCredentialFailure(
  error: unknown,
): error is ApiError & { code: ApiErrorCode } {
  return (
    error instanceof ApiError &&
    error.code !== null &&
    CREDENTIAL_FAILURE_CODES.has(error.code)
  );
}

interface ApiFailureContext {
  method: string;
  url: string;
  status: number;
  contentType: string;
}

/**
 * Turns a failed response body into an {@link ApiError}. A body matching the
 * shared error contract supplies the display message and structured context;
 * any other body keeps the diagnostic text so an unexpected proxy or crash
 * page is still actionable.
 */
export function apiFailure(text: string, context: ApiFailureContext): ApiError {
  const contract = parseErrorContract(text);
  if (contract !== null) {
    return new ApiError(contract.message, context.status, {
      code: contract.code,
      ...(contract.details === undefined ? {} : { details: contract.details }),
    });
  }

  const detail = text.trim();
  return new ApiError(
    `${context.method} ${context.url} failed: ${context.status} (${context.contentType})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
    context.status,
  );
}

function parseErrorContract(text: string): {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
} | null {
  try {
    const parsed = apiErrorResponseSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.error : null;
  } catch {
    return null;
  }
}

// Fetches a URL and parses it as JSON, recording a Sentry breadcrumb for the
// request and throwing an Error that carries enough context (URL, status,
// content type) to make the resulting Sentry event actionable even when the
// underlying failure has no stack trace of its own (e.g. Response.json()'s
// native SyntaxError). An `init.signal` reaches the native fetch unchanged, so
// an aborted request rejects with the platform's AbortError before any of the
// error handling below runs.
export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const method = init?.method ?? "GET";
  const res = await fetch(url, init);
  const status = res.status;
  const contentType = res.headers.get("content-type") ?? "unknown";

  Sentry.addBreadcrumb({
    category: "http",
    level: res.ok ? "info" : "error",
    message: `${method} ${url}`,
    data: { url, method, status, content_type: contentType },
  });

  const text = await res.text();

  if (!res.ok) {
    if (status === 426) {
      reportApiOutdated();
    }
    throw apiFailure(text, { method, url, status, contentType });
  }

  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new Error(
      `${method} ${url} returned invalid JSON (status ${status}, ${contentType})`,
      { cause },
    );
  }
}
