# Garmin sidecar

A small FastAPI service wrapping
[`python-garminconnect`](https://github.com/cyberjunky/python-garminconnect) so
the Bun/Hono API can sync the operator's last 31 days of Garmin activities
without adding a Python runtime to the main backend (see ADR 0003 amendment and
`docs/specs/garmin-activity-integration.md`).

> This uses Garmin Connect's **unofficial** internal API, which is against
> Garmin's terms of service. It is a chosen risk for personal use only.

## Run

From the repository root:

```sh
bun run dev:garmin   # sidecar only (listens on :8000 by default)
bun run dev          # sidecar alongside the web and API dev servers
```

The first run creates `.venv` and installs `requirements.txt`. To set it up
manually instead:

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python app.py
```

## Container

`Dockerfile` builds the Cloud Run image. It listens on `$PORT` (Cloud Run sets
`8080`) and runs as an unprivileged user. The deploy workflow publishes it as
the **private** Cloud Run services `killingit-garmin-test` / `killingit-garmin`;
the API invokes them with an OIDC identity token (see the root README).

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
- The `/sync` activities are normalized to the shared `Activity` shape
  (`id`, `name`, `type`, `startDate` ISO-8601 UTC, `distance` m, `movingTime` s,
  `elapsedTime` s, `totalElevationGain` m) plus a `samples` timeseries.
- Each sample is built from Garmin's `get_activity_details()` metrics and
  contains a UTC `timestamp` plus any recorded channels: `latitude`,
  `longitude`, `heartRate` (bpm), `power` (W), `temperature` (°C), `speed`
  (m/s), `distance` (m, cumulative), `elevation` (m), and `cadence`. Absent
  channels are omitted per sample.
- Activity-detail calls add one Garmin request per activity. If a detail fetch
  fails, that activity is returned with `samples: []` and the sync continues;
  Garmin rate limiting still fails the whole sync with `429`.
