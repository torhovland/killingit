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
#   scripts/agent.sh logs <api|garmin> [--env test|prod] [--tail N]
#   scripts/agent.sh sql "<query>" [--env test|prod] [--write]
#
set -euo pipefail

PROJECT="${GCP_PROJECT:-}"
REGION="us-central1"
ENV="test"
TAIL=100
WRITE=0

log() { printf 'agent> %s\n' "$*" >&2; }

usage() {
  cat >&2 <<'EOF'
Usage:
  scripts/agent.sh logs <api|garmin> [--env test|prod] [--tail N]
  scripts/agent.sh sql "<query>" [--env test|prod] [--write]

  logs   Read Cloud Run logs: the API (api) or the Garmin sidecar (garmin).
  sql    Run one SQL query against the Neon database.

  --env test|prod   Target environment (default: test).
  --tail N          Number of log lines to read (default: 100).
  --write           Open a read-write SQL session (default: read-only).

The sql command uses DATABASE_URL_TEST for test and DATABASE_URL_PROD for prod,
never both, and its session is read-only unless --write is given.
EOF
}

die() {
  log "$*"
  usage
  exit 2
}

args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      [[ $# -ge 2 ]] || die "--env requires test or prod"
      ENV="$2"
      shift 2
      ;;
    --env=*)
      ENV="${1#--env=}"
      shift
      ;;
    --tail)
      [[ $# -ge 2 ]] || die "--tail requires a number"
      TAIL="$2"
      shift 2
      ;;
    --tail=*)
      TAIL="${1#--tail=}"
      shift
      ;;
    --write)
      WRITE=1
      shift
      ;;
    --)
      shift
      args+=("$@")
      break
      ;;
    -*)
      die "unknown option: $1"
      ;;
    *)
      args+=("$1")
      shift
      ;;
  esac
done
set -- "${args[@]}"

case "$ENV" in
  test | prod) ;;
  *) die "unknown environment: ${ENV} (expected test or prod)" ;;
esac
[[ "$TAIL" =~ ^[0-9]+$ ]] || die "--tail requires a non-negative number"

[[ $# -gt 0 ]] || die "missing command (logs|sql)"
cmd="$1"
shift

case "$cmd" in
  logs)
    [[ $# -gt 0 ]] || die "logs requires a service (api|garmin)"
    if ((WRITE)); then
      die "--write is only valid for sql"
    fi
    service="$1"
    shift
    [[ $# -eq 0 ]] || die "unexpected argument: $1"

    case "$service" in
      api) service="killingit-api" ;;
      garmin) service="killingit-garmin" ;;
      *) die "unknown service: ${service} (expected api or garmin)" ;;
    esac

    [[ -n "$PROJECT" ]] || die "GCP_PROJECT is not set."

    if [[ "$ENV" == "test" ]]; then
      suffix="-test"
    else
      suffix=""
    fi
    log "Reading logs for ${service}${suffix} (${ENV})"
    gcloud run services logs read "${service}${suffix}" \
      --project "$PROJECT" \
      --region "$REGION" \
      --limit "$TAIL"
    ;;
  sql)
    [[ $# -gt 0 ]] || die "sql requires a query string"
    query="$1"
    shift
    [[ $# -eq 0 ]] || die "unexpected argument: $1"

    case "$ENV" in
      test) url_var="DATABASE_URL_TEST" ;;
      prod) url_var="DATABASE_URL_PROD" ;;
    esac
    url="${!url_var:-}"
    [[ -n "$url" ]] || die "${url_var} is not set."

    if ((WRITE)); then
      session="read-write"
      write_note=" (--write)"
    else
      session="read-only"
      write_note=""
      # Refuse writes at the server, however the query is worded. A deliberate
      # write needs --write; see docs/specs/agent-access-script.md.
      export PGOPTIONS="-c default_transaction_read_only=on"
    fi
    log "Running SQL against Neon (${ENV}, ${session} session${write_note}): ${query}"

    if command -v psql >/dev/null 2>&1; then
      psql "$url" -c "$query"
    else
      log "psql not found; using Docker."
      docker run --rm -i -e PGOPTIONS postgres:16-alpine psql "$url" -c "$query"
    fi
    ;;
  *)
    die "unknown command: ${cmd} (expected logs|sql)"
    ;;
esac
