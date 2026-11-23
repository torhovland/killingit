/**
 * Whether the URL carries an Auth0 redirect response the SDK has not consumed
 * yet.
 *
 * The SDK reads `code` (or `error`) and `state` from `window.location.search`
 * during its first effect. The app's route guards run in a child effect before
 * that, so a canonical redirect that kept only the path would drop the query
 * and make the SDK take its signed-out branch: the authorization code would
 * never be exchanged and the athlete would stay on the landing page after a
 * successful sign-in.
 *
 * This mirrors the SDK's own check, which also accepts a `connect_code`; this
 * app does not use account linking, so a code or error is enough.
 */
export function hasAuthCallbackParams(
  search: string = window.location.search,
): boolean {
  const params = new URLSearchParams(search);
  return params.has("state") && (params.has("code") || params.has("error"));
}
