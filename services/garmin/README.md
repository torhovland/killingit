# Garmin sidecar

A small FastAPI service wrapping
[`python-garminconnect`](https://github.com/cyberjunky/python-garminconnect) so
the Bun/Hono API can sync the operator's last 31 days of Garmin activities
without adding a Python runtime to the main backend (see ADR 0003 amendment and
`docs/specs/garmin-activity-integration.md`).

> This uses Garmin Connect's **unofficial** internal API, which is against
> Garmin's terms of service. It is a chosen risk for personal use only.

## Run

```sh
# create a virtualenv and install deps
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt

# run (listens on :8000 by default)
python app.py
```

## Endpoints

| Method | Path            | Body                   | Response                 |
| ------ | --------------- | ---------------------- | ------------------------ |
| `POST` | `/authenticate` | `{username, password}` | 204 (or 401/403/429/502) |
| `POST` | `/sync`         | `{username, password}` | `{ activities: [...] }`  |
| `GET`  | `/health`       | —                      | `{status: "ok"}`         |

The Bun API talks to this service via `GARMIN_SIDECAR_URL` (default
`http://localhost:8000`).

Garmin rate-limits repeated SSO logins (`429`), so the sidecar caches the
library's session tokens per username under `GARMIN_TOKENSTORE_DIR` (defaults to
a private `0700` temp dir). `/authenticate` logs in once; `/sync` reuses the
cached session.

## Test

```sh
pip install -r requirements-dev.txt
pytest
```

## Notes

- MFA-required Garmin accounts are **not supported** and return 403.
- The `/sync` activities are normalized to the shared `ActivitySummary` shape
  (`id`, `name`, `type`, `startDate` ISO-8601 UTC, `distance` m, `movingTime` s,
  `elapsedTime` s, `totalElevationGain` m).
