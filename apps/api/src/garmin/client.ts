import type { ActivitySummary } from "@killingit/shared";

/**
 * Thrown when the Garmin sidecar rejects a request — either an authentication
 * failure (bad credentials) or some other error the sidecar surfaced.
 */
export class GarminSidecarError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "GarminSidecarError";
  }
}

/** Raised specifically for bad-credentials responses (mapped to 401). */
export class GarminAuthError extends GarminSidecarError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 401, options);
    this.name = "GarminAuthError";
  }
}

/** Credentials the sidecar needs to log into Garmin Connect. */
export interface GarminCredentials {
  username: string;
  password: string;
}

export type SyncTransport = (
  credentials: GarminCredentials,
) => Promise<ActivitySummary[]>;

/** Base URL of the sidecar, from env (defaults to the local dev address). */
export function garminSidecarUrl(): string {
  return process.env.GARMIN_SIDECAR_URL?.trim() ?? "http://localhost:8000";
}

/**
 * Authenticates credentials against the sidecar (which tries a Garmin login)
 * without fetching activities. Returns true on success.
 */
export async function authenticateGarmin(
  credentials: GarminCredentials,
  transport: AuthenticateTransport = postAuthenticate,
): Promise<boolean> {
  await transport(credentials);
  return true;
}

type AuthenticateTransport = (credentials: GarminCredentials) => Promise<void>;

/**
 * Fetches the last 31 days of activities from the sidecar, mapped to the
 * shared {@link ActivitySummary} shape. The transport is injectable so tests
 * stub the network.
 */
export async function syncGarminActivities(
  credentials: GarminCredentials,
  transport: SyncTransport = postSync,
): Promise<ActivitySummary[]> {
  return transport(credentials);
}

/** Default transport: POSTs credentials to the sidecar's `/sync` endpoint. */
async function postSync(
  credentials: GarminCredentials,
): Promise<ActivitySummary[]> {
  const res = await sidecarPost("/sync", credentials);
  const body = (await res.json()) as { activities?: unknown };
  if (!Array.isArray(body.activities)) {
    throw new GarminSidecarError(
      "sidecar returned a malformed activities payload",
    );
  }
  return body.activities as ActivitySummary[];
}

/** Default transport: POSTs credentials to the sidecar's `/authenticate`. */
async function postAuthenticate(credentials: GarminCredentials): Promise<void> {
  const res = await sidecarPost("/authenticate", credentials);
  await res.text();
}

/** Shared POST helper with sidecar error mapping. */
async function sidecarPost(
  path: string,
  credentials: GarminCredentials,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${garminSidecarUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: credentials.username,
        password: credentials.password,
      }),
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
