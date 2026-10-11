#!/usr/bin/env bash
#
# Agent-access script for the Killing It deployment.
#
# Provides the coding agent with a single, documented way to:
#   1. Read Cloud Run application logs.
#   2. Run a SQL query against the Neon Postgres database.
#
# Requirements (installed + authenticated once, see README / ADR 0001):
#   - gcloud  (gcloud auth login + gcloud config set project)
#   - psql    (or `docker run` as fallback)
#
# Usage:
#   scripts/agent.sh logs api [--env test|prod] [--tail 100]
#   scripts/agent.sh sql "SELECT * FROM athletes;" [--env test|prod]
#
set -euo pipefail

PROJECT="${GCP_PROJECT:-}"
REGION="us-central1"
SERVICE_NAME="killingit-api"
ENV="prod" # default

log() { printf 'agent> %s\n' "$*" >&2; }

# ---- env override ----
for arg in "$@"; do
  case "$arg" in
    --env) : ;;
  esac
done
# parse --env properly
prev=""
args=()
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--env" ]]; then
    ENV="$2"
    shift 2
  elif [[ "$1" == "--tail" ]]; then
    TAIL="$2"
    shift 2
  else
    args+=("$1")
    shift
  fi
done
set -- "${args[@]}"
TAIL="${TAIL:-100}"

[[ -z "$PROJECT" ]] && { log "GCP_PROJECT is not set."; exit 1; }

env_suffix() { [[ "$ENV" == "prod" ]] && echo "" || echo "-test"; }

cmd="$1"; shift || { log "missing command (logs|sql)"; exit 1; }

case "$cmd" in
  logs)
    log "Reading logs for ${SERVICE_NAME}$(env_suffix) (${ENV})"
    gcloud run services logs read "${SERVICE_NAME}$(env_suffix)" \
      --project "$PROJECT" \
      --region "$REGION" \
      --limit "$TAIL"
    ;;
  sql)
    sql="$1"; shift || { log "sql requires a query string"; exit 1; }
    [[ -z "$DATABASE_URL" ]] && { log "DATABASE_URL is not set."; exit 1; }
    log "Running SQL against Neon (${ENV}): $sql"
    if command -v psql >/dev/null 2>&1; then
      psql "$DATABASE_URL" -c "$sql"
    else
      log "psql not found; using Docker."
      docker run --rm -i postgres:16-alpine psql "$DATABASE_URL" -c "$sql"
    fi
    ;;
  *)
    log "unknown command: $cmd (expected logs|sql)"
    exit 1
    ;;
esac