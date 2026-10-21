import { z } from "zod";

/**
 * The role of an account in this environment. The first account provisioned in
 * a database is an admin; everyone after is a member.
 */
export const userRoleSchema = z.enum(["admin", "member"]);

export type UserRole = z.infer<typeof userRoleSchema>;

/**
 * The signed-in user as resolved by the API. `sub` is the auth provider's
 * subject; `role` is the application's own authorisation role (never taken
 * from a token claim).
 */
export const currentUserSchema = z.object({
  sub: z.string(),
  role: userRoleSchema,
});

export type CurrentUser = z.infer<typeof currentUserSchema>;
