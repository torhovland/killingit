import { currentUserSchema } from "@killingit/shared";
import { Hono } from "hono";
import { getAthlete } from "../auth/middleware.js";
import type { UserStore } from "../users/store.js";

/**
 * Returns the signed-in user with their application role. Provisioning here is
 * what creates the account row on first sign-in, so the web app learns whether
 * the admin settings page is available.
 */
export function createMeRoute(users: UserStore): Hono {
  return new Hono().get("/", async (c) => {
    const identity = getAthlete(c);
    const user = await users.ensureUser(identity.sub);
    return c.json(
      currentUserSchema.parse({ sub: identity.sub, role: user.role }),
    );
  });
}
