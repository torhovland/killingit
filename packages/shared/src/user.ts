import { z } from "zod";

/**
 * The role of an account in this environment. The first account provisioned in
 * a database is an admin; everyone after is a member.
 */
export const userRoleSchema = z.enum(["admin", "member"]);

export type UserRole = z.infer<typeof userRoleSchema>;

/** Whether `value` is an IANA time zone name the runtime understands. */
export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * An IANA time zone such as `Europe/Oslo`. A null setting means "use the
 * device's time zone", which lets a user follow their current location.
 */
export const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(isValidTimeZone, "Unknown time zone");

export type TimeZone = z.infer<typeof timeZoneSchema>;

/**
 * The athlete's home location. Decimal degrees in WGS 84; `name` is a label
 * such as "Oslo, Norway" and may be null when the athlete picked a point on the
 * map instead of searching for an address.
 */
export const athleteLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().trim().max(200).nullable().default(null),
});

export type AthleteLocation = z.infer<typeof athleteLocationSchema>;

/**
 * Body of `PATCH /api/me`. Each setting is optional so the settings page can
 * save one without resending the others, but an empty patch is rejected. Null
 * clears a setting.
 */
export const userSettingsUpdateSchema = z
  .object({
    timezone: timeZoneSchema.nullable().optional(),
    location: athleteLocationSchema.nullable().optional(),
  })
  .refine(
    (value) => value.timezone !== undefined || value.location !== undefined,
    {
      message: "Provide at least one setting",
      path: ["timezone"],
    },
  );

export type UserSettingsUpdate = z.infer<typeof userSettingsUpdateSchema>;

/**
 * The signed-in user as resolved by the API. `sub` is the auth provider's
 * subject; `role` is the application's own authorisation role (never taken
 * from a token claim); `timezone` is the athlete's preferred display zone;
 * `location` is the home location used for weather-aware planning.
 */
export const currentUserSchema = z.object({
  sub: z.string(),
  role: userRoleSchema,
  timezone: z.string().nullable().default(null),
  location: athleteLocationSchema.nullable().default(null),
});

export type CurrentUser = z.infer<typeof currentUserSchema>;
