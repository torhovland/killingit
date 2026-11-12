import * as Sentry from "@sentry/react";
import { reportApiOutdated, withApiVersion } from "./apiVersion";
import { fetchJson, apiFailure, ApiError } from "./fetchJson";
import type { AuthState } from "./auth";

/**
 * Fetch JSON, attaching a bearer token when authenticated. Uses the same
 * Sentry-breadcrumb-emitting `fetchJson` underneath. A 401 can mean the cached
 * access token expired between renewals, so renew once with the provider's
 * cache bypassed and retry the request before surfacing the failure. A 426
 * means the API no longer answers this app build's contract version, which the
 * app shows as an update notice.
 */
export async function fetchJsonAuthed<T>(
  url: string,
  auth: AuthState,
  init?: RequestInit,
): Promise<T> {
  const token = await auth.getToken();
  try {
    return await requestJson<T>(url, token, init);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw error;
    }
    const refreshed = await auth.getToken({ forceRefresh: true });
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
 * their own parse-and-throw sequence.
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
 * Fetch a binary response, applying the same authentication and one-shot token
 * refresh as {@link fetchJsonAuthed}. Used for file downloads such as workout
 * exports, where the response is not JSON.
 */
export async function fetchFileAuthed(
  url: string,
  auth: AuthState,
  init?: RequestInit,
): Promise<DownloadedFile> {
  const token = await auth.getToken();
  try {
    return await requestFile(url, token, init);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw error;
    }
    const refreshed = await auth.getToken({ forceRefresh: true });
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
