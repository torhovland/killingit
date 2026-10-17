import { z } from "zod";

/** The authenticated athlete identity exposed to API handlers. */
export const athleteIdentitySchema = z.object({
  sub: z.string(),
});

export type AthleteIdentity = z.infer<typeof athleteIdentitySchema>;
