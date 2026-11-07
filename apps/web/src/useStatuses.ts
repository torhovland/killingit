import { useCallback, useEffect, useState } from "react";
import {
  garminConnectionStatusSchema,
  llmSettingsSchema,
  type GarminConnectionStatus,
  type LlmSettings,
} from "@killingit/shared";
import type { AuthState } from "./auth";
import { requestParsed } from "./fetchAuthed";
import { reportError } from "./reportError";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export interface IntegrationStatuses {
  garmin: GarminConnectionStatus | null;
  llm: LlmSettings | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * Loads the two integration statuses the coaching pages need: whether Garmin is
 * connected and how the LLM is configured. Both pages share this loader so a
 * new status or validation change reaches them together.
 */
export function useStatuses(auth: AuthState): IntegrationStatuses {
  const [garmin, setGarmin] = useState<GarminConnectionStatus | null>(null);
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [garmin, llm] = await Promise.all([
        requestParsed(
          `${API_URL}/api/garmin/status`,
          auth,
          garminConnectionStatusSchema,
          "Loading the Garmin status",
        ),
        requestParsed(
          `${API_URL}/api/llm/settings`,
          auth,
          llmSettingsSchema,
          "Loading the LLM settings",
        ),
      ]);
      setGarmin(garmin);
      setLlm(llm);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    void reload();
  }, [auth.isAuthenticated, reload]);

  return { garmin, llm, loading, error, reload };
}
