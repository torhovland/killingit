import {
  garminConnectionStatusSchema,
  zonedDateTime,
  type GarminConnectionStatus,
} from "@killingit/shared";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../http/validation.js";
import { getUser } from "../auth/middleware.js";
import type { ResolvedAppDependencies } from "../dependencies.js";
import {
  athleteFailureMessage,
  respondUpstreamError,
  serviceUnavailable,
} from "../http/errors.js";
import {
  authenticateGarmin,
  GarminNotConnectedError,
  syncGarminActivities,
} from "../garmin/client.js";
import { loadDecryptedGarminCredentials } from "../garmin/credentials.js";
import { encrypt, garminCredentialsKeyFromEnv } from "../garmin/crypto.js";
import { loadCredentials, saveCredentials } from "../garmin/store.js";
import { syncGarminSupplements } from "../garmin/supplements.js";

/** Request body for POST /credentials — raw (soon-to-be-encrypted) values. */
const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Garmin integration routes (ADR 0003 amendment). All paths sit behind auth and
 * scope credentials to the signed-in account. Credentials/ciphertext are never
 * serialized back to the client.
 */
export function createGarminRoute(deps: ResolvedAppDependencies): Hono {
  const loadStored = deps.loadGarminCredentials ?? loadCredentials;
  const saveStored = deps.saveGarminCredentials ?? saveCredentials;
  const loadDecrypted =
    deps.loadDecryptedGarminCredentials ?? loadDecryptedGarminCredentials;
  const authenticate = deps.authenticateGarmin ?? authenticateGarmin;
  const sync = deps.syncGarminActivities ?? syncGarminActivities;
  const syncSupplements = deps.syncGarminSupplements ?? syncGarminSupplements;
  const now = deps.now ?? (() => new Date());

  return new Hono()
    .post("/credentials", zValidator("json", credentialsSchema), async (c) => {
      const user = getUser(c);
      const { username, password } = c.req.valid("json");

      let key;
      try {
        key = await garminCredentialsKeyFromEnv();
      } catch (err) {
        // A missing or invalid key names an environment secret, which is an
        // operator detail; the athlete gets a generic answer and the log keeps
        // the real reason.
        return serviceUnavailable(
          c,
          athleteFailureMessage(err, {
            fallback: "Garmin is not available right now. Try again later.",
            logLabel: "[garmin] credentials key failure",
          }),
        );
      }

      // Validate with Garmin before persisting anything, so bad credentials
      // fail fast and are never stored.
      try {
        await authenticate({ username, password });
      } catch (err) {
        return respondUpstreamError(
          c,
          err,
          "[garmin] credential validation failure",
        );
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
        return respondUpstreamError(
          c,
          new GarminNotConnectedError(),
          "[garmin] not connected",
        );
      }

      try {
        const activities = await sync(credentials);
        // Body composition and daily health supplement the activity sync; the
        // shared pass is fail-open, so neither can fail this response.
        await syncSupplements(
          user.id,
          credentials,
          zonedDateTime(now(), user.timezone).date,
        );
        return c.json({ activities });
      } catch (err) {
        // The sidecar's own status survives: a Garmin auth failure (401),
        // MFA-required (403), a rate limit (429) and a gateway error (502) stay
        // distinguishable from an unexpected failure.
        return respondUpstreamError(c, err, "[garmin] activities failure");
      }
    });
}
