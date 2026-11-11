/**
 * The API contract the web app and the API both speak. Bump it whenever a
 * request or response shape changes incompatibly, and hold
 * `API_MIN_SUPPORTED_VERSION` at the previous value for one release so the two
 * deploys can overlap without breaking an open app. See
 * `docs/specs/api-versioning.md`.
 */
export const API_CONTRACT_VERSION = 1;

/**
 * The oldest contract the API still answers. Raise it only after every web
 * build that speaks the older contract has been superseded.
 */
export const API_MIN_SUPPORTED_VERSION = 1;

/** Header the web app sends on every API request to declare its contract. */
export const API_VERSION_HEADER = "x-killingit-api-version";
