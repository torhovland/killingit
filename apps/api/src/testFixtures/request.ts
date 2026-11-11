import { API_CONTRACT_VERSION, API_VERSION_HEADER } from "@killingit/shared";

/**
 * A test request that declares the API contract the web app sends. Every
 * protected route is version-gated, so a test that omits the header is refused
 * before it reaches the handler it means to exercise.
 */
export function apiRequest(input: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set(API_VERSION_HEADER, String(API_CONTRACT_VERSION));
  return new Request(input, { ...init, headers });
}
