#!/usr/bin/env bash
#
# Run the Python Garmin sidecar (services/garmin) in development.
#
# `bun run dev` starts this alongside the web and API dev servers; to run only
# the sidecar use `bun run dev:garmin`. The virtualenv is created and the
# requirements installed on first run.
#
# Uvicorn's reloader restarts the sidecar when a Python file in services/garmin
# changes, matching the web and API dev servers. It needs an import string
# ("app:app") rather than the app object, so the module's own `_run()` (used by
# the container image) is bypassed here.
#
set -euo pipefail

SIDECAR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../services/garmin" && pwd)"
VENV="$SIDECAR_DIR/.venv"

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "dev-garmin> creating virtualenv and installing requirements" >&2
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet -r "$SIDECAR_DIR/requirements.txt"
fi

exec "$VENV/bin/python" -m uvicorn app:app \
  --reload \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --app-dir "$SIDECAR_DIR" \
  --reload-dir "$SIDECAR_DIR"
