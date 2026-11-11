#!/usr/bin/env bash
#
# Run every quality gate for the Python Garmin sidecar (services/garmin):
# pytest, ruff lint, ruff format check and mypy.
#
# CI runs this same script, so `bun run check:garmin` locally checks exactly what
# a pull request is checked with. The virtualenv and dev requirements are
# created/installed on demand. The ruff, mypy and pytest versions are pinned in
# requirements-dev.txt; pyproject.toml holds their configuration.
#
set -euo pipefail

SIDECAR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../services/garmin" && pwd)"
VENV="$SIDECAR_DIR/.venv"

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "check-garmin> creating virtualenv and installing requirements" >&2
  python3 -m venv "$VENV"
fi
"$VENV/bin/pip" install --quiet --disable-pip-version-check \
  -r "$SIDECAR_DIR/requirements-dev.txt"

cd "$SIDECAR_DIR"
echo "check-garmin> pytest" >&2
"$VENV/bin/python" -m pytest
echo "check-garmin> ruff check" >&2
"$VENV/bin/ruff" check .
echo "check-garmin> ruff format --check" >&2
"$VENV/bin/ruff" format --check .
echo "check-garmin> mypy" >&2
"$VENV/bin/mypy"
