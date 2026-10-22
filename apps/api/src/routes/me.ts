import { currentUserSchema, userSettingsUpdateSchema } from "@killingit/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getAthlete } from "../auth/middleware.js";
import type { StoredUser, UserStore } from "../users/store.js";

function toCurrentUser(sub: string, user: StoredUser) {
  return currentUserSchema.parse({
    sub,
    role: user.role,
    timezone: user.timezone,
  });
}

/**
 * Returns the signed-in user with their application role and settings.
 * Provisioning here is what creates the account row on first sign-in, so the
 * web app learns whether the admin settings page is available.
 */
export function createMeRoute(users: UserStore): Hono {
  return new Hono()
    .get("/", async (c) => {
      const identity = getAthlete(c);
      const user = await users.ensureUser(identity.sub);
      return c.json(toCurrentUser(identity.sub, user));
    })
    .patch("/", zValidator("json", userSettingsUpdateSchema), async (c) => {
      const identity = getAthlete(c);
      await users.ensureUser(identity.sub);
      const { timezone } = c.req.valid("json");
      const user = await users.updateTimezone(identity.sub, timezone);
      return c.json(toCurrentUser(identity.sub, user));
    });
}
