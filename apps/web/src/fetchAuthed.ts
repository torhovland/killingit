import * as Sentry from "@sentry/react";
import { reportApiOutdated, withApiVersion } from "./apiVersion";
import {
  fetchJson,
  apiFailure,
  ApiError,
  isCredentialFailure,
} from "./fetchJson";
import type { AuthState } from "./auth";

/**
 * Fetch JSON, attaching a bearer token when authenticated. Uses the same
 * Sentry-breadcrumb-emitting `fetchJson` underneath. `init.signal` aborts the
 * request, including a token refresh that is waiting to start, and the
 * rejection stays the platform's `AbortError` rather than becoming an
 * {@link ApiError}. A 401 can mean the cached access token expired between
 * renewals, so renew once with the provider's cache bypassed and retry the
 * request before surfacing the failure. A third-party credential failure is
 * never renewed, even if a provider answers 401, because the session is valid
 * and the athlete has to fix the connection. A 426 means the API no longer
 * answers this app build's contract version, which the app shows as an update
 * notice.
 */
export async function fetchJsonAuthed<T>(
  url: string,
  auth: AuthState,
  init?: RequestInit,
): Promise<T> {
  const signal = init?.signal;
  signal?.throwIfAborted();
  const token = await auth.getToken();
  signal?.throwIfAborted();
  try {
    return await requestJson<T>(url, token, init);
  } catch (error) {
    if (!shouldRenewSession(error)) {
      throw error;
    }
    signal?.throwIfAborted();
    const refreshed = await auth.getToken({ forceRefresh: true });
    signal?.throwIfAborted();
    if (!refreshed) {
      throw error;
    }
    return requestJson<T>(url, refreshed, init);
  }
}

function requestJson<T>(
  url: string,
  token: string | undefined,
  init: RequestInit | undefined,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  return fetchJson<T>(url, { ...init, headers: withApiVersion(headers) });
}

/**
 * Whether a failure can mean the cached access token expired. A credential
 * failure is excluded by its code as well as its status, so a provider that
 * one day answers 401 again cannot make the client renew a valid session.
 */
function shouldRenewSession(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 401 &&
    !isCredentialFailure(error)
  );
}

/**
 * A successful response body that did not match the shared schema it was
 * validated against. Carries the schema's issues as the cause.
 */
export class ResponseValidationError extends Error {
  constructor(label: string, options?: { cause?: unknown }) {
    super(`${label} returned an unexpected response`, options);
    this.name = "ResponseValidationError";
  }
}

/**
 * The schema shape `requestParsed` needs: any validator that can report a
 * typed success or a failure. A structural type keeps the web app from taking
 * a direct dependency on zod while still accepting the shared zod schemas.
 */
export interface ResponseSchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: unknown };
}

/**
 * Fetch JSON with {@link fetchJsonAuthed} and validate the body against
 * `schema`. A response that does not match throws one uniform
 * {@link ResponseValidationError} naming the action, so callers never write
 * their own parse-and-throw sequence. `init.signal` is forwarded unchanged and
 * an aborted request rejects without validating a body.
 */
export async function requestParsed<T>(
  url: string,
  auth: AuthState,
  schema: ResponseSchema<T>,
  label: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetchJsonAuthed<unknown>(url, auth, init);
  const parsed = schema.safeParse(response);
  if (!parsed.success) {
    throw new ResponseValidationError(label, { cause: parsed.error });
  }
  return parsed.data;
}

/** A downloaded file and the filename the server suggested for it. */
export interface DownloadedFile {
  blob: Blob;
  filename: string | null;
}

/**
 * Fetch a binary response, applying the same authentication, one-shot token
 * refresh and `init.signal` abort handling as {@link fetchJsonAuthed}. Used for
 * file downloads such as workout exports, where the response is not JSON.
 */
export async function fetchFileAuthed(
  url: string,
  auth: AuthState,
  init?: RequestInit,
): Promise<DownloadedFile> {
  const signal = init?.signal;
  signal?.throwIfAborted();
  const token = await auth.getToken();
  signal?.throwIfAborted();
  try {
    return await requestFile(url, token, init);
  } catch (error) {
    if (!shouldRenewSession(error)) {
      throw error;
    }
    signal?.throwIfAborted();
    const refreshed = await auth.getToken({ forceRefresh: true });
    signal?.throwIfAborted();
    if (!refreshed) {
      throw error;
    }
    return requestFile(url, refreshed, init);
  }
}

async function requestFile(
  url: string,
  token: string | undefined,
  init: RequestInit | undefined,
): Promise<DownloadedFile> {
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const method = init?.method ?? "GET";
  const response = await fetch(url, {
    ...init,
    headers: withApiVersion(headers),
  });
  const contentType = response.headers.get("content-type") ?? "unknown";

  Sentry.addBreadcrumb({
    category: "http",
    level: response.ok ? "info" : "error",
    message: `${method} ${url}`,
    data: { url, method, status: response.status, content_type: contentType },
  });

  if (!response.ok) {
    if (response.status === 426) {
      reportApiOutdated();
    }
    throw apiFailure(await response.text(), {
      method,
      url,
      status: response.status,
      contentType,
    });
  }

  return {
    blob: await response.blob(),
    filename: filenameFromContentDisposition(
      response.headers.get("content-disposition"),
    ),
  };
}

function filenameFromContentDisposition(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utf8?.[1] !== undefined) {
    try {
      return decodeURIComponent(utf8[1].trim());
    } catch {
      return utf8[1].trim();
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(value);
  if (quoted?.[1] !== undefined) {
    return quoted[1];
  }
  const plain = /filename=([^;]+)/i.exec(value);
  const name = plain?.[1]?.trim();
  return name === undefined || name === "" ? null : name;
}
