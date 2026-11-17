import { useEffect } from "react";
import type { AuthState } from "./auth";
import { fetchJsonAuthed } from "./fetchAuthed";
import { reportErrorQuietly } from "./reportError";

/**
 * Asks the API to refresh OpenRouter's catalog on a page visit. The API checks
 * its own 24-hour timestamp, so this is cheap on every other visit. The refresh
 * is failed open: the page keeps the catalog it already has, and a failure is
 * recorded without a UI message.
 */
export function useModelCatalogRefresh(auth: AuthState): void {
  useEffect(() => {
    if (!auth.isAuthenticated) return;
    void fetchJsonAuthed<unknown>("/api/llm/models/refresh", auth, {
      method: "POST",
    }).catch((error: unknown) => {
      reportErrorQuietly(error);
    });
  }, [auth]);
}
