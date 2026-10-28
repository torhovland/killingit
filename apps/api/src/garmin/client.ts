import {
  garminMetricsResponseSchema,
  type Activity,
  type GarminMetricsResponse,
} from "@killingit/shared";

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
) => Promise<Activity[]>;

/** Injectable transport for the body-composition and FTP sync. */
export type SyncMetricsTransport = (
  credentials: GarminCredentials,
) => Promise<GarminMetricsResponse>;

/** Base URL of the sidecar, from env (defaults to the local dev address). */
export function garminSidecarUrl(): string {
  return process.env.GARMIN_SIDECAR_URL?.trim() ?? "http://localhost:8000";
}

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
export async function sidecarAuthHeaders(
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
    res = await fetchFn(url, { headers: { "Metadata-Flavor": "Google" } });
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
 * Fetches the last 42 days of activities (with their workout timeseries) from
 * the sidecar, mapped to the shared {@link Activity} shape. The transport is
 * injectable so tests stub the network.
 */
export async function syncGarminActivities(
  credentials: GarminCredentials,
  transport: SyncTransport = postSync,
): Promise<Activity[]> {
  return transport(credentials);
}

/** Default transport: POSTs credentials to the sidecar's `/sync` endpoint. */
async function postSync(credentials: GarminCredentials): Promise<Activity[]> {
  const res = await sidecarPost("/sync", credentials);
  const body = (await res.json()) as { activities?: unknown };
  if (!Array.isArray(body.activities)) {
    throw new GarminSidecarError(
      "sidecar returned a malformed activities payload",
    );
  }
  return body.activities as Activity[];
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
  const res = await sidecarPost("/metrics", credentials);
  const parsed = garminMetricsResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new GarminSidecarError(
      "sidecar returned a malformed body-metrics payload",
    );
  }
  return parsed.data;
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
  const authHeaders = await sidecarAuthHeaders();

  let res: Response;
  try {
    res = await fetch(`${garminSidecarUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders },
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
