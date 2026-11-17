import * as Sentry from "@sentry/react";
import { apiUrl } from "./apiUrl";
import { reportApiOutdated, withApiVersion } from "./apiVersion";
import { fetchJson, apiFailure, ApiError } from "./fetchJson";
import type { AuthState } from "./auth";

/**
 * A request init for {@link fetchJsonAuthed} and {@link requestParsed}. `json`
 * is serialised into the body and sent with a `content-type: application/json`
 * header unless the caller sets a content type. `body` is omitted so a call
 * site cannot send an unserialised body next to `json`.
 */
type JsonRequestInit = Omit<RequestInit, "body"> & { json?: unknown };

/**
 * Fetch JSON, attaching a bearer token when authenticated. Takes an API path
 * and resolves it against the build's origin with {@link apiUrl}, so no caller
 * reads `VITE_API_URL`. Uses the same Sentry-breadcrumb-emitting `fetchJson`
 * underneath. A `json` value becomes the serialised request body. `init.signal`
 * aborts the request, including a token refresh that is waiting to start, and
 * the rejection stays the platform's `AbortError` rather than becoming an
 * {@link ApiError}. A 401 can mean the cached access token expired between
 * renewals, so renew once with the provider's cache bypassed and retry the
 * request before surfacing the failure. A 426 means the API no longer answers
 * this app build's contract version, which the app shows as an update notice.
 */
export async function fetchJsonAuthed<T>(
  path: string,
  auth: AuthState,
  init?: JsonRequestInit,
): Promise<T> {
  const signal = init?.signal;
  signal?.throwIfAborted();
  const token = await auth.getToken();
  signal?.throwIfAborted();
  const url = apiUrl(path);
  try {
    return await requestJson<T>(url, token, init);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
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
  init: JsonRequestInit | undefined,
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const headers = new Headers(rest.headers);
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  if (json !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return fetchJson<T>(url, {
    ...rest,
    headers: withApiVersion(headers),
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
}

/**
 * A successful response body that did not match the shared schema it was
 * validated against. Carries the schema's issues as the cause.
 */
class ResponseValidationError extends Error {
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
 * `schema`. The first argument is an API path, which `fetchJsonAuthed`
 * resolves against the build's origin. It takes the same JSON request init as
 * `fetchJsonAuthed`, so a `json` value is serialised into the request body. A
 * response that does not match throws one uniform
 * {@link ResponseValidationError} naming the action, so callers never write
 * their own parse-and-throw sequence. `init.signal` is forwarded unchanged and
 * an aborted request rejects without validating a body.
 */
export async function requestParsed<T>(
  path: string,
  auth: AuthState,
  schema: ResponseSchema<T>,
  label: string,
  init?: JsonRequestInit,
): Promise<T> {
  const response = await fetchJsonAuthed<unknown>(path, auth, init);
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
 * refresh and `init.signal` abort handling as {@link fetchJsonAuthed}. Takes an
 * API path, resolved against the build's origin, and is used for file
 * downloads such as workout exports, where the response is not JSON.
 */
export async function fetchFileAuthed(
  path: string,
  auth: AuthState,
  init?: RequestInit,
): Promise<DownloadedFile> {
  const signal = init?.signal;
  signal?.throwIfAborted();
  const token = await auth.getToken();
  signal?.throwIfAborted();
  const url = apiUrl(path);
  try {
    return await requestFile(url, token, init);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
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
