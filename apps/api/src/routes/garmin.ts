import {
  garminConnectionStatusSchema,
  type GarminConnectionStatus,
} from "@killingit/shared";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getAthlete } from "../auth/middleware.js";
import {
  authenticateGarmin,
  GarminAuthError,
  GarminSidecarError,
  syncGarminActivities,
} from "../garmin/client.js";
import { loadDecryptedGarminCredentials } from "../garmin/credentials.js";
import { encrypt, garminCredentialsKeyFromEnv } from "../garmin/crypto.js";
import { loadCredentials, saveCredentials } from "../garmin/store.js";
import type { UserStore } from "../users/store.js";

/** Request body for POST /credentials — raw (soon-to-be-encrypted) values. */
const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export interface GarminRouteDependencies {
  users: UserStore;
  /** Injectable for tests; default to the database-backed store. */
  loadStoredCredentials?: typeof loadCredentials;
  saveStoredCredentials?: typeof saveCredentials;
  loadDecryptedCredentials?: typeof loadDecryptedGarminCredentials;
  authenticate?: typeof authenticateGarmin;
  syncActivities?: typeof syncGarminActivities;
}

/**
 * Garmin integration routes (ADR 0003 amendment). All paths sit behind auth and
 * scope credentials to the signed-in account. Credentials/ciphertext are never
 * serialized back to the client.
 */
export function createGarminRoute(deps: GarminRouteDependencies): Hono {
  const loadStored = deps.loadStoredCredentials ?? loadCredentials;
  const saveStored = deps.saveStoredCredentials ?? saveCredentials;
  const loadDecrypted =
    deps.loadDecryptedCredentials ?? loadDecryptedGarminCredentials;
  const authenticate = deps.authenticate ?? authenticateGarmin;
  const sync = deps.syncActivities ?? syncGarminActivities;

  return new Hono()
    .post("/credentials", zValidator("json", credentialsSchema), async (c) => {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const { username, password } = c.req.valid("json");

      let key;
      try {
        key = await garminCredentialsKeyFromEnv();
      } catch (err) {
        return c.text((err as Error).message, 503);
      }

      // Validate with Garmin before persisting anything, so bad credentials
      // fail fast and are never stored.
      try {
        await authenticate({ username, password });
      } catch (err) {
        if (err instanceof GarminAuthError) {
          return c.text(err.message, 401);
        }
        // Surface MFA-required (403), Garmin rate limiting (429), and sidecar
        // gateway errors (502) as themselves instead of a generic 503.
        if (err instanceof GarminSidecarError && err.status) {
          c.status(err.status as 403 | 429 | 502);
          return c.text(err.message);
        }
        console.error("[garmin] credential validation failure:", err);
        return c.text("Service Unavailable", 503);
      }

      const [usernameEncrypted, passwordEncrypted] = await Promise.all([
        encrypt(username, key),
        encrypt(password, key),
      ]);
      await saveStored(user.id, { usernameEncrypted, passwordEncrypted });
      return c.json(garminConnectionStatusSchema.parse({ connected: true }));
    })
    .get("/status", async (c) => {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const stored = await loadStored(user.id);
      const status: GarminConnectionStatus = {
        connected: stored !== null,
      };
      return c.json(garminConnectionStatusSchema.parse(status));
    })
    .get("/activities", async (c) => {
      const user = await deps.users.ensureUser(getAthlete(c).sub);

      let credentials;
      try {
        credentials = await loadDecrypted(user.id);
      } catch (err) {
        console.error("[garmin] could not read stored credentials:", err);
        return c.text(
          "Garmin credentials are unavailable (check GARMIN_CREDENTIALS_KEY)",
          503,
        );
      }
      if (!credentials) {
        return c.text("Not connected to Garmin", 401);
      }

      try {
        const activities = await sync(credentials);
        return c.json({ activities });
      } catch (err) {
        if (err instanceof GarminAuthError) {
          return c.text(err.message, 401);
        }
        if (err instanceof GarminSidecarError && err.status) {
          // Pass the sidecar's status through so callers can distinguish an
          // auth problem (401), MFA-required (403), and Garmin rate limiting
          // (429) from a genuine gateway failure (502).
          c.status(err.status as 401 | 403 | 429 | 502);
          return c.text(err.message);
        }
        console.error("[garmin] activities failure:", err);
        return c.text("Service Unavailable", 503);
      }
    });
}
