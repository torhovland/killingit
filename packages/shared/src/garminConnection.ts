import { z } from "zod";

/**
 * Connection status exposed to the API client for the Garmin integration.
 * Deliberately carries no usernames/passwords or other secrets — only whether
 * an (encrypted) Garmin credential set exists.
 */
export const garminConnectionStatusSchema = z.object({
  connected: z.boolean(),
});

export type GarminConnectionStatus = z.infer<
  typeof garminConnectionStatusSchema
>;
