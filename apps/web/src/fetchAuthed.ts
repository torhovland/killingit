import * as Sentry from "@sentry/react";
import { fetchJson, ApiError } from "./fetchJson";
import type { AuthState } from "./auth";

/**
 * Fetch JSON, attaching a bearer token when authenticated. Uses the same
 * Sentry-breadcrumb-emitting `fetchJson` underneath. A 401 can mean the cached
 * access token expired between renewals, so renew once with the provider's
 * cache bypassed and retry the request before surfacing the failure.
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

  return fetchJson<T>(url, { ...init, headers });
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
  const response = await fetch(url, { ...init, headers });
  const contentType = response.headers.get("content-type") ?? "unknown";

  Sentry.addBreadcrumb({
    category: "http",
    level: response.ok ? "info" : "error",
    message: `${method} ${url}`,
    data: { url, method, status: response.status, content_type: contentType },
  });

  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new ApiError(
      `${method} ${url} failed: ${response.status} (${contentType})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      response.status,
    );
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
