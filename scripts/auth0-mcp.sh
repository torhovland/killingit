#!/usr/bin/env bash
#
# OpenCode MCP launcher for the Auth0 management server.
#
# Background
# ----------
# The Auth0 MCP server normally stores its access token in the OS keychain
# (KDE Wallet / Secret Service) under service "auth0-mcp". OpenCode launches
# local MCP subprocesses with a clean environment that lacks a D-Bus session
# address, so the server cannot read the keychain and exits with "No valid
# authorization token found".
#
# That flow also only authenticates against Auth0's *community* tenant
# (auth0.auth0.com) and never grants `offline_access`, so its tokens expire
# (~9h) with no way to refresh them. See ADR 0002 for the tenant decision.
#
# Approach (own tenant + self-renewing)
# -------------------------------------
# This wrapper instead mints a fresh Management API token for *our* tenant on
# every launch using the OAuth client-credentials (Machine-to-Machine) grant.
# Client-credentials has no refresh token, but the grant itself is cheap and
# stateless, so re-minting on launch is the canonical "auto-renew" strategy --
# there is no token to expire on disk and no manual `init` step.
#
# Credentials are read from a gitignored file (.env.auth0.local) and injected
# as AUTH0_TOKEN / AUTH0_DOMAIN, which the server honors and uses to skip its
# keychain lookup (see dist/utils/config.js and dist/commands/run.js). No
# secrets are written to the repository.
#
# Required file (gitignored) -- create it with:
#   AUTH0_M2M_CLIENT_ID=<your M2M client id>
#   AUTH0_M2M_CLIENT_SECRET=<your M2M client secret>
#   # optional override:
#   # AUTH0_DOMAIN=dev-5qhhcjppmcpsomq0.us.auth0.com
#
# Equivalent grant request (what this script performs):
#   POST https://<domain>/oauth/token
#        grant_type=client_credentials&client_id=...&client_secret=...
#        &audience=https://<domain>/api/v2/
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env.auth0.local"

# Default to our development tenant; allow override via the env file or the
# process environment.
AUTH0_DOMAIN="${AUTH0_DOMAIN:-dev-5qhhcjppmcpsomq0.us.auth0.com}"

# Load the gitignored credential file if present. `set -a` exports each
# KEY=value line so values become available below (and to any child).
# shellcheck disable=SC1090
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

err() { printf 'auth0-mcp: %s\n' "$*" >&2; }

if [[ -z "${AUTH0_M2M_CLIENT_ID:-}" || -z "${AUTH0_M2M_CLIENT_SECRET:-}" ]]; then
  err "missing M2M credentials (AUTH0_M2M_CLIENT_ID / AUTH0_M2M_CLIENT_SECRET)."
  err "Create $ENV_FILE with both values (it is gitignored),"
  err "or export them in the environment."
  exit 1
fi

AUDIENCE="https://${AUTH0_DOMAIN}/api/v2/"
TOKEN_ENDPOINT="https://${AUTH0_DOMAIN}/oauth/token"

err "Minting Management API token for ${AUTH0_DOMAIN} ..."

# Perform the client-credentials grant. We write the body to a temp file to
# avoid exposing the secret on the process command line (visible via ps).
BODY_TMP="$(mktemp)"
trap 'rm -f "$BODY_TMP"' EXIT
printf 'grant_type=client_credentials&client_id=%s&client_secret=%s&audience=%s' \
  "$AUTH0_M2M_CLIENT_ID" "$AUTH0_M2M_CLIENT_SECRET" "$AUDIENCE" > "$BODY_TMP"

if command -v curl >/dev/null 2>&1; then
  TOKEN_RESPONSE="$(curl -fsS -X POST "$TOKEN_ENDPOINT" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-binary "@$BODY_TMP" 2>/dev/null)" \
    || { err "token request failed (curl). Check M2M client id/secret and scopes."; exit 1; }
else
  TOKEN_RESPONSE="$(wget -qO- --post-file="$BODY_TMP" \
    --header='Content-Type: application/x-www-form-urlencoded' \
    "$TOKEN_ENDPOINT" 2>/dev/null)" \
    || { err "token request failed (wget). Check M2M client id/secret and scopes."; exit 1; }
fi

# Extract access_token with a minimal portable JSON parser (no jq dependency
# guaranteed; prefer jq when present for robustness).
if command -v jq >/dev/null 2>&1; then
  ACCESS_TOKEN="$(printf '%s' "$TOKEN_RESPONSE" | jq -er '.access_token')" \
    || { err "token response had no access_token: $(printf '%s' "$TOKEN_RESPONSE" | jq -r '.error // .error_description // empty' 2>/dev/null)"; exit 1; }
else
  ACCESS_TOKEN="$(printf '%s' "$TOKEN_RESPONSE" \
    | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  [[ -n "$ACCESS_TOKEN" ]] || { err "token response missing access_token (and jq not available)."; exit 1; }
fi

export AUTH0_TOKEN="$ACCESS_TOKEN"
export AUTH0_DOMAIN

# The server skips its keychain lookup when AUTH0_TOKEN + AUTH0_DOMAIN are set.
exec npx -y @auth0/auth0-mcp-server run "$@"