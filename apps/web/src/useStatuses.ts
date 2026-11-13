import {
  garminConnectionStatusSchema,
  llmSettingsSchema,
  type GarminConnectionStatus,
  type LlmSettings,
} from "@killingit/shared";
import type { AuthState } from "./auth";
import { useApiResources } from "./useApiResource";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export interface IntegrationStatuses {
  garmin: GarminConnectionStatus | null;
  llm: LlmSettings | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Loads the two integration statuses the coaching pages need: whether Garmin is
 * connected and how the LLM is configured. Both pages share this loader so a
 * new status or validation change reaches them together.
 */
export function useStatuses(auth: AuthState): IntegrationStatuses {
  const statuses = useApiResources(
    auth.isAuthenticated
      ? {
          garmin: {
            path: `${API_URL}/api/garmin/status`,
            schema: garminConnectionStatusSchema,
            action: "Loading the Garmin status",
          },
          llm: {
            path: `${API_URL}/api/llm/settings`,
            schema: llmSettingsSchema,
            action: "Loading the LLM settings",
          },
        }
      : null,
  );

  return {
    garmin: statuses.data?.garmin ?? null,
    llm: statuses.data?.llm ?? null,
    loading: statuses.loading,
    error: statuses.error,
    reload: statuses.reload,
  };
}
