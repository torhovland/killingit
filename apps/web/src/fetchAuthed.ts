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
