import {
  API_CONTRACT_VERSION,
  API_MIN_SUPPORTED_VERSION,
  API_VERSION_HEADER,
} from "@killingit/shared";
import type { MiddlewareHandler } from "hono";
import { apiError } from "./http/errors.js";

/** Status for an app build whose contract the API no longer answers. */
const CLIENT_OUTDATED = 426;

/**
 * Refuses a request from an app build outside the supported contract range, so
 * a stale bundle fails fast and visibly instead of tripping over a changed
 * response shape later. The web app treats `426` as "reload to update".
 *
 * The range admits the previous contract for one release, which lets an API
 * deploy land before the web deploy that replaces every open client.
 */
export const enforceApiVersion: MiddlewareHandler = async (c, next) => {
  const received = c.req.header(API_VERSION_HEADER);
  const version = received === undefined ? Number.NaN : Number(received);
  if (
    Number.isInteger(version) &&
    version >= API_MIN_SUPPORTED_VERSION &&
    version <= API_CONTRACT_VERSION
  ) {
    await next();
    return;
  }

  return apiError(
    c,
    CLIENT_OUTDATED,
    "This app version is out of date. Reload to update.",
    {
      details: {
        requiredVersion: API_CONTRACT_VERSION,
        receivedVersion: received ?? null,
      },
    },
  );
};
