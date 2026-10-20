import {
  garminConnectionStatusSchema,
  type GarminConnectionStatus,
} from "@killingit/shared";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  authenticateGarmin,
  GarminAuthError,
  GarminSidecarError,
  syncGarminActivities,
} from "../garmin/client.js";
import {
  decrypt,
  encrypt,
  garminCredentialsKeyFromEnv,
} from "../garmin/crypto.js";
import { loadCredentials, saveCredentials } from "../garmin/store.js";

/** Request body for POST /credentials — raw (soon-to-be-encrypted) values. */
const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Decrypts the stored credential set using the env key. Returns null when no
 * credentials are stored (caller maps that to "not connected").
 */
async function loadDecrypted(): Promise<{
  username: string;
  password: string;
} | null> {
  const stored = await loadCredentials();
  if (!stored) {
    return null;
  }
  const key = await garminCredentialsKeyFromEnv();
  return {
    username: await decrypt(stored.usernameEncrypted, key),
    password: await decrypt(stored.passwordEncrypted, key),
  };
}

/**
 * Garmin integration routes (ADR 0003 amendment). All paths sit behind auth and
 * never serialize credentials/ciphertext back to the client.
 */
export const garminRoute = new Hono()
  .post("/credentials", zValidator("json", credentialsSchema), async (c) => {
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
      await authenticateGarmin({ username, password });
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
    await saveCredentials({ usernameEncrypted, passwordEncrypted });
    return c.json(garminConnectionStatusSchema.parse({ connected: true }));
  })
  .get("/status", async (c) => {
    const stored = await loadCredentials();
    const status: GarminConnectionStatus = {
      connected: stored !== null,
    };
    return c.json(garminConnectionStatusSchema.parse(status));
  })
  .get("/activities", async (c) => {
    const credentials = await loadDecrypted();
    if (!credentials) {
      return c.text("Not connected to Garmin", 401);
    }

    try {
      const activities = await syncGarminActivities(credentials);
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
