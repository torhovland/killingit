import { currentUserSchema, userSettingsUpdateSchema } from "@killingit/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getAthlete, getUser } from "../auth/middleware.js";
import type { StoredUser, UserStore } from "../users/store.js";

function toCurrentUser(sub: string, user: StoredUser) {
  return currentUserSchema.parse({
    sub,
    role: user.role,
    timezone: user.timezone,
    location: user.location,
    dietAdvice: user.dietAdvice,
  });
}

/**
 * Returns the signed-in user with their application role and settings. The
 * account is provisioned by the auth middleware on first sign-in, so the web
 * app learns whether the admin settings page is available.
 */
export function createMeRoute(users: UserStore): Hono {
  return new Hono()
    .get("/", (c) => {
      const identity = getAthlete(c);
      return c.json(toCurrentUser(identity.sub, getUser(c)));
    })
    .patch("/", zValidator("json", userSettingsUpdateSchema), async (c) => {
      const identity = getAthlete(c);
      const { timezone, location, dietAdvice } = c.req.valid("json");
      const user = await users.updateSettings(identity.sub, {
        ...(timezone !== undefined ? { timezone } : {}),
        ...(location !== undefined ? { location } : {}),
        ...(dietAdvice !== undefined ? { dietAdvice } : {}),
      });
      return c.json(toCurrentUser(identity.sub, user));
    })
    .delete("/", async (c) => {
      const identity = getAthlete(c);
      await users.deleteUser(identity.sub);
      // The client signs out after this, so the identity cannot provision the
      // account again on the next request.
      return c.json({ deleted: true });
    });
}
