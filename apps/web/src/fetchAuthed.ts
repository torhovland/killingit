import { fetchJson } from "./fetchJson";
import type { AuthState } from "./auth/auth0";

/**
 * Fetch JSON, attaching a bearer token when authenticated. Uses the same
 * Sentry-breadcrumb-emitting `fetchJson` underneath.
 */
export async function fetchJsonAuthed<T>(
  url: string,
  auth: AuthState,
  init?: RequestInit,
): Promise<T> {
  const token = await auth.getToken();

  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  return fetchJson<T>(url, { ...init, headers });
}
