import {
  activitySchema,
  garminDailyResponseSchema,
  garminMetricsResponseSchema,
  type Activity,
  type ApiErrorCode,
  type GarminDailyResponse,
  type GarminMetricsResponse,
} from "@killingit/shared";
import { z } from "zod";
import { UpstreamError } from "../http/errors.js";

/**
 * Thrown when the Garmin sidecar rejects a request — either an authentication
 * failure (bad credentials) or some other error the sidecar surfaced. The
 * failure carries the status it is reported with; one without a status of its
 * own is reported as unavailable.
 */
export class GarminSidecarError extends UpstreamError {
  constructor(
    message: string,
    status?: number,
    options?: { code?: ApiErrorCode; cause?: unknown },
  ) {
    super(message, { status, ...options });
    this.name = "GarminSidecarError";
  }
}

/**
 * Raised when Garmin rejects the credentials the athlete stored. It is not a
 * session failure: the athlete fixes it by updating the connection, so it is
 * reported as `422` with `garmin_auth_failed` rather than an `401` a client
 * would try to renew. See ADR 0036.
 */
class GarminAuthError extends GarminSidecarError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 422, { code: "garmin_auth_failed", ...options });
    this.name = "GarminAuthError";
  }
}

/**
 * Raised when the account has not connected Garmin yet. Like a rejected login,
 * this asks the athlete to connect rather than to sign in again, so it is a
 * `409` with its own code.
 */
export class GarminNotConnectedError extends UpstreamError {
  constructor() {
    super("Not connected to Garmin", {
      status: 409,
      code: "garmin_not_connected",
    });
    this.name = "GarminNotConnectedError";
  }
}

/** Credentials the sidecar needs to log into Garmin Connect. */
export interface GarminCredentials {
  username: string;
  password: string;
}

export type SyncTransport = (
  credentials: GarminCredentials,
  knownActivityIds: readonly number[],
) => Promise<Activity[]>;

/** Injectable transport for the body-composition and FTP sync. */
export type SyncMetricsTransport = (
  credentials: GarminCredentials,
) => Promise<GarminMetricsResponse>;

/** Injectable transport for one day's health and recovery metrics. */
export type SyncDailyTransport = (
  credentials: GarminCredentials,
  date: string,
) => Promise<GarminDailyResponse>;

/** Base URL of the sidecar, from env (defaults to the local dev address). */
function garminSidecarUrl(): string {
  return process.env.GARMIN_SIDECAR_URL?.trim() || "http://localhost:8000";
}

/**
 * A Garmin sync or daily backfill can spend minutes talking to Garmin. Keep the
 * wait under the API server's 255-second idle timeout so a hung sidecar fails
 * with a typed error instead of holding the request open.
 */
const SIDECAR_REQUEST_TIMEOUT_MS = 240_000;

/** The metadata token endpoint answers immediately; fail fast when it does not. */
const METADATA_REQUEST_TIMEOUT_MS = 5_000;

/** Cloud Run metadata endpoint that mints an OIDC identity token. */
const METADATA_IDENTITY_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

/** Identity tokens live for an hour; refresh comfortably before then. */
const ID_TOKEN_TTL_MS = 45 * 60 * 1000;

let cachedIdToken: {
  audience: string;
  token: string;
  expiresAt: number;
} | null = null;

/**
 * Returns the headers that authenticate the API to the sidecar.
 *
 * In deployed environments the sidecar is a private Cloud Run service, so the
 * API must present an OIDC identity token whose audience is the sidecar URL
 * (`GARMIN_SIDECAR_AUDIENCE`). Locally the variable is unset and the sidecar
 * accepts plain requests. Tokens are cached in memory until shortly before
 * they expire.
 */
async function sidecarAuthHeaders(
  env: Record<string, string | undefined> = process.env,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<Record<string, string>> {
  const audience = env.GARMIN_SIDECAR_AUDIENCE?.trim();
  if (!audience) {
    return {};
  }

  if (cachedIdToken?.audience === audience && cachedIdToken.expiresAt > now()) {
    return { authorization: `Bearer ${cachedIdToken.token}` };
  }

  const url = `${METADATA_IDENTITY_URL}?audience=${encodeURIComponent(audience)}`;
  let res: Response;
  try {
    res = await fetchFn(url, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(METADATA_REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new GarminSidecarError(
      "could not obtain an identity token for the Garmin sidecar",
      undefined,
      { cause },
    );
  }
  if (!res.ok) {
    throw new GarminSidecarError(
      `Garmin sidecar identity token endpoint returned ${res.status}`,
    );
  }

  const token = (await res.text()).trim();
  if (token === "") {
    throw new GarminSidecarError(
      "Garmin sidecar identity token endpoint returned an empty token",
    );
  }

  cachedIdToken = { audience, token, expiresAt: now() + ID_TOKEN_TTL_MS };
  return { authorization: `Bearer ${token}` };
}

/**
 * Authenticates credentials against the sidecar (which tries a Garmin login)
 * without fetching activities. It resolves once the sidecar accepts them, and
 * rejects with the sidecar's failure otherwise.
 */
export async function authenticateGarmin(
  credentials: GarminCredentials,
  transport: AuthenticateTransport = postAuthenticate,
): Promise<void> {
  await transport(credentials);
}

type AuthenticateTransport = (credentials: GarminCredentials) => Promise<void>;

/**
 * The sidecar's `/sync` request body. The ids the API already stores let the
 * sidecar skip their bulk detail, splits and set calls; it still returns the
 * whole window, so a summary Garmin changed is refreshed.
 */
function garminSyncRequestBody(
  credentials: GarminCredentials,
  knownActivityIds: readonly number[],
): Record<string, unknown> {
  return {
    ...credentialsBody(credentials),
    knownActivityIds: knownActivityIds.map(String),
  };
}

/** The sidecar's `/sync` response wrapper around the activity list. */
const garminSyncResponseSchema = z.object({
  activities: activitySchema.array(),
});

/**
 * POSTs a body to the sidecar and validates the JSON response against
 * `schema`. A malformed payload raises a {@link GarminSidecarError} that keeps
 * the Zod error as its cause, so every sidecar response path reports a parse
 * failure the same way and the reason survives to the log.
 */
async function postAndValidate<S extends z.ZodType>(
  path: string,
  body: Record<string, unknown>,
  schema: S,
  malformedMessage: string,
): Promise<z.infer<S>> {
  const res = await sidecarPost(path, body);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    throw new GarminSidecarError(malformedMessage, undefined, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/**
 * Fetches the last 42 days of activities (with their workout timeseries) from
 * the sidecar, mapped to the shared {@link Activity} shape. The transport is
 * injectable so tests stub the network.
 *
 * `knownActivityIds` are the activities the API already stores, so the sidecar
 * skips their bulk payloads; an empty list downloads every activity in full.
 */
export async function syncGarminActivities(
  credentials: GarminCredentials,
  knownActivityIds: readonly number[] = [],
  transport: SyncTransport = postSync,
): Promise<Activity[]> {
  return transport(credentials, knownActivityIds);
}

/** Default transport: POSTs credentials to the sidecar's `/sync` endpoint. */
async function postSync(
  credentials: GarminCredentials,
  knownActivityIds: readonly number[],
): Promise<Activity[]> {
  const { activities } = await postAndValidate(
    "/sync",
    garminSyncRequestBody(credentials, knownActivityIds),
    garminSyncResponseSchema,
    "sidecar returned a malformed activities payload",
  );
  return activities;
}

/**
 * Fetches body-composition weigh-ins and the historic cycling FTP from the
 * sidecar. The transport is injectable so tests stub the network.
 */
export async function syncGarminMetrics(
  credentials: GarminCredentials,
  transport: SyncMetricsTransport = postMetrics,
): Promise<GarminMetricsResponse> {
  return transport(credentials);
}

/** Default transport: POSTs credentials to the sidecar's `/metrics` endpoint. */
async function postMetrics(
  credentials: GarminCredentials,
): Promise<GarminMetricsResponse> {
  return postAndValidate(
    "/metrics",
    credentialsBody(credentials),
    garminMetricsResponseSchema,
    "sidecar returned a malformed body-metrics payload",
  );
}

/**
 * Fetches one day of health and recovery metrics from the sidecar. The
 * transport is injectable so tests stub the network.
 */
export async function syncGarminDailyMetrics(
  credentials: GarminCredentials,
  date: string,
  transport: SyncDailyTransport = postDaily,
): Promise<GarminDailyResponse> {
  return transport(credentials, date);
}

/** Default transport: POSTs credentials and a date to the sidecar's `/daily`. */
async function postDaily(
  credentials: GarminCredentials,
  date: string,
): Promise<GarminDailyResponse> {
  return postAndValidate(
    "/daily",
    { ...credentialsBody(credentials), date },
    garminDailyResponseSchema,
    "sidecar returned a malformed daily-metrics payload",
  );
}

/** Default transport: POSTs credentials to the sidecar's `/authenticate`. */
async function postAuthenticate(credentials: GarminCredentials): Promise<void> {
  const res = await sidecarPost("/authenticate", credentialsBody(credentials));
  await res.text();
}

/** The credential fields every sidecar request body carries. */
function credentialsBody(
  credentials: GarminCredentials,
): Record<string, unknown> {
  return { username: credentials.username, password: credentials.password };
}

/** Shared POST helper with sidecar error mapping. */
async function sidecarPost(
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const authHeaders = await sidecarAuthHeaders();

  let res: Response;
  try {
    res = await fetch(`${garminSidecarUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SIDECAR_REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new GarminSidecarError("could not reach Garmin sidecar", undefined, {
      cause,
    });
  }

  if (res.status === 401) {
    throw new GarminAuthError(
      await sidecarDetail(res, "invalid Garmin credentials"),
    );
  }

  if (!res.ok) {
    throw new GarminSidecarError(
      await sidecarDetail(res, `Garmin sidecar returned ${res.status}`),
      res.status,
    );
  }

  return res;
}

/** Reads the sidecar's `detail` message, falling back to a default string. */
async function sidecarDetail(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  if (!text) {
    return fallback;
  }
  try {
    const body = JSON.parse(text) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail !== "") {
      return body.detail;
    }
  } catch {
    // Not JSON — use the raw text if it is short enough to be a message.
    return text.length <= 200 ? text : fallback;
  }
  return fallback;
}
