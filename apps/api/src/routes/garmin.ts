import {
  garminConnectionStatusSchema,
  type GarminConnectionStatus,
} from "@killingit/shared";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../http/validation.js";
import { getUser } from "../auth/middleware.js";
import { apiError, serviceUnavailable, unauthorized } from "../http/errors.js";
import {
  authenticateGarmin,
  GarminAuthError,
  GarminSidecarError,
  syncGarminActivities,
  syncGarminMetrics,
} from "../garmin/client.js";
import { loadDecryptedGarminCredentials } from "../garmin/credentials.js";
import { encrypt, garminCredentialsKeyFromEnv } from "../garmin/crypto.js";
import { loadCredentials, saveCredentials } from "../garmin/store.js";
import { syncGarminDailyHistory } from "../garmin/dailySync.js";
import { syncGarminSupplements } from "../garmin/supplements.js";
import { recordGarminBodyMetrics, recordGarminFtp } from "../metrics/store.js";

/** Request body for POST /credentials — raw (soon-to-be-encrypted) values. */
const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export interface GarminRouteDependencies {
  /** Injectable for tests; default to the database-backed store. */
  loadStoredCredentials?: typeof loadCredentials;
  saveStoredCredentials?: typeof saveCredentials;
  loadDecryptedCredentials?: typeof loadDecryptedGarminCredentials;
  authenticate?: typeof authenticateGarmin;
  syncActivities?: typeof syncGarminActivities;
  syncMetrics?: typeof syncGarminMetrics;
  /** Injectable for tests; defaults to the daily health backfill. */
  syncDaily?: typeof syncGarminDailyHistory;
  /** Injectable for tests; defaults to the database-backed writer. */
  saveMetrics?: typeof recordGarminBodyMetrics;
  /** Injectable for tests; defaults to the database-backed writer. */
  saveFtp?: typeof recordGarminFtp;
}

/**
 * Garmin integration routes (ADR 0003 amendment). All paths sit behind auth and
 * scope credentials to the signed-in account. Credentials/ciphertext are never
 * serialized back to the client.
 */
export function createGarminRoute(deps: GarminRouteDependencies = {}): Hono {
  const loadStored = deps.loadStoredCredentials ?? loadCredentials;
  const saveStored = deps.saveStoredCredentials ?? saveCredentials;
  const loadDecrypted =
    deps.loadDecryptedCredentials ?? loadDecryptedGarminCredentials;
  const authenticate = deps.authenticate ?? authenticateGarmin;
  const sync = deps.syncActivities ?? syncGarminActivities;
  const syncMetrics = deps.syncMetrics ?? syncGarminMetrics;
  const syncDaily = deps.syncDaily ?? syncGarminDailyHistory;
  const saveMetrics = deps.saveMetrics ?? recordGarminBodyMetrics;
  const saveFtp = deps.saveFtp ?? recordGarminFtp;

  return new Hono()
    .post("/credentials", zValidator("json", credentialsSchema), async (c) => {
      const user = getUser(c);
      const { username, password } = c.req.valid("json");

      let key;
      try {
        key = await garminCredentialsKeyFromEnv();
      } catch (err) {
        return serviceUnavailable(c, (err as Error).message);
      }

      // Validate with Garmin before persisting anything, so bad credentials
      // fail fast and are never stored.
      try {
        await authenticate({ username, password });
      } catch (err) {
        if (err instanceof GarminAuthError) {
          return unauthorized(c, err.message);
        }
        // Surface MFA-required (403), Garmin rate limiting (429), and sidecar
        // gateway errors (502) as themselves instead of a generic 503.
        if (err instanceof GarminSidecarError && err.status) {
          return apiError(c, err.status, err.message);
        }
        console.error("[garmin] credential validation failure:", err);
        return serviceUnavailable(c);
      }

      const [usernameEncrypted, passwordEncrypted] = await Promise.all([
        encrypt(username, key),
        encrypt(password, key),
      ]);
      await saveStored(user.id, { usernameEncrypted, passwordEncrypted });
      return c.json(garminConnectionStatusSchema.parse({ connected: true }));
    })
    .get("/status", async (c) => {
      const user = getUser(c);
      const stored = await loadStored(user.id);
      const status: GarminConnectionStatus = {
        connected: stored !== null,
      };
      return c.json(garminConnectionStatusSchema.parse(status));
    })
    .get("/activities", async (c) => {
      const user = getUser(c);

      let credentials;
      try {
        credentials = await loadDecrypted(user.id);
      } catch (err) {
        console.error("[garmin] could not read stored credentials:", err);
        return serviceUnavailable(
          c,
          "Garmin credentials are unavailable (check GARMIN_CREDENTIALS_KEY)",
        );
      }
      if (!credentials) {
        return unauthorized(c, "Not connected to Garmin");
      }

      try {
        const activities = await sync(credentials);
        await syncGarminSupplements(
          user.id,
          credentials,
          new Date().toISOString().slice(0, 10),
          { syncMetrics, saveMetrics, saveFtp, syncDaily },
        );
        return c.json({ activities });
      } catch (err) {
        if (err instanceof GarminAuthError) {
          return unauthorized(c, err.message);
        }
        if (err instanceof GarminSidecarError && err.status) {
          // Pass the sidecar's status through so callers can distinguish an
          // auth problem (401), MFA-required (403), and Garmin rate limiting
          // (429) from a genuine gateway failure (502).
          return apiError(c, err.status, err.message);
        }
        console.error("[garmin] activities failure:", err);
        return serviceUnavailable(c);
      }
    });
}
