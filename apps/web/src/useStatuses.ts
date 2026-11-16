import type { Dispatch, SetStateAction } from "react";
import {
  garminConnectionStatusSchema,
  llmSettingsSchema,
  type GarminConnectionStatus,
  type LlmSettings,
} from "@killingit/shared";
import type { AuthState } from "./auth";
import { useApiResources, type ApiResourceOptions } from "./useApiResource";

/** The two integration statuses as the shared requests return them. */
interface IntegrationStatusData {
  garmin: GarminConnectionStatus;
  llm: LlmSettings;
}

export interface IntegrationStatuses {
  garmin: GarminConnectionStatus | null;
  llm: LlmSettings | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Replaces a status after a save, for example new Garmin credentials. */
  setData: Dispatch<SetStateAction<IntegrationStatusData | null>>;
}

/**
 * The single loader for the two integration statuses: whether Garmin is
 * connected and how the LLM is configured. Every consumer shares this loader so
 * a new status or validation change reaches them together.
 *
 * `options` is forwarded to `useApiResources`, so a page that owns a
 * page-level spinner can register it through `statusSource`. A caller that
 * saves a status passes the new value to `setData` instead of refetching.
 */
export function useStatuses(
  auth: AuthState,
  options: ApiResourceOptions = {},
): IntegrationStatuses {
  const statuses = useApiResources(
    auth.isAuthenticated
      ? {
          garmin: {
            path: "/api/garmin/status",
            schema: garminConnectionStatusSchema,
            action: "Loading the Garmin status",
          },
          llm: {
            path: "/api/llm/settings",
            schema: llmSettingsSchema,
            action: "Loading the LLM settings",
          },
        }
      : null,
    options,
  );

  return {
    garmin: statuses.data?.garmin ?? null,
    llm: statuses.data?.llm ?? null,
    loading: statuses.loading,
    error: statuses.error,
    reload: statuses.reload,
    setData: statuses.setData,
  };
}
