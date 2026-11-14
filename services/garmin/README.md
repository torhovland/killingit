# Garmin sidecar

A small FastAPI service wrapping
[`python-garminconnect`](https://github.com/cyberjunky/python-garminconnect) so
the Bun/Hono API can sync the operator's last 42 days of Garmin activities
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

The first run creates `.venv` and installs `requirements.txt`. The dev script
runs Uvicorn with `--reload`, so editing a file in `services/garmin` restarts the
sidecar automatically. To set it up manually instead:

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python app.py
```

## Layout

`app.py` is only the FastAPI app, the request models and the five routes. Each
concern lives in its own module beside it:

| Module          | Owns                                                                |
| --------------- | ------------------------------------------------------------------- |
| `auth.py`       | Login, token store and the `Credentials` request model              |
| `activities.py` | Activity summaries, detail samples, laps and strength sets          |
| `body.py`       | Weigh-ins, body fat and historic cycling FTP                        |
| `daily.py`      | One day of daily stats, sleep, readiness and VO2max                 |
| `values.py`     | Numeric/date coercions, metric ranges and the 42-day sync window    |
| `errors.py`     | Domain errors, the `rate_limited` context manager and `http_errors` |

Every route is decorated with `errors.http_errors`, so a new route cannot forget
the status mapping, and every Garmin call goes through `errors.rate_limited`, so
a new call cannot forget the `429`. The tests follow the same modules
(`test_auth.py`, `test_activities.py`, `test_body.py`, `test_daily.py`,
`test_errors.py`, `test_values.py`) and share their Garmin stubs through
`support.py`. See `docs/specs/garmin-sidecar-modules.md` and ADR 0058.

## Container

`Dockerfile` builds the Cloud Run image. It listens on `$PORT` (Cloud Run sets
`8080`) and runs as an unprivileged user. The deploy workflow publishes it as
the **private** Cloud Run services `killingit-garmin-test` / `killingit-garmin`;
the API invokes them with an OIDC identity token (see the root README).

## Endpoints

| Method | Path            | Body                         | Response                         |
| ------ | --------------- | ---------------------------- | -------------------------------- |
| `POST` | `/authenticate` | `{username, password}`       | 204 (or 401/403/429/502)         |
| `POST` | `/sync`         | `{username, password}`       | `{ activities: [...] }`          |
| `POST` | `/metrics`      | `{username, password}`       | `{ metrics: [...], ftp: [...] }` |
| `POST` | `/daily`        | `{username, password, date}` | `{ date, metrics: {...} }`       |
| `GET`  | `/health`       | —                            | `{status: "ok"}`                 |

The Bun API talks to this service via `GARMIN_SIDECAR_URL` (default
`http://localhost:8000`).

Garmin rate-limits repeated SSO logins (`429`), so the sidecar caches the
library's session tokens per username under `GARMIN_TOKENSTORE_DIR` (defaults to
a private `0700` temp dir). `/authenticate` logs in once; `/sync` reuses the
cached session.

## Test

From the repository root:

```sh
bun run check:garmin
```

That creates `services/garmin/.venv` if needed, installs
`requirements-dev.txt` (the runtime requirements plus pinned `pytest`, `ruff`
and `mypy`), and runs the same four gates CI runs: `pytest`,
`ruff check`, `ruff format --check` and `mypy`. Their configuration lives in
`pyproject.toml`.

To run the suite inside an existing virtualenv instead:

```sh
pip install -r requirements-dev.txt
pytest
```

## Contract fixtures

`contract/` holds one committed JSON file per endpoint (`sync.json`,
`metrics.json`, `daily.json`): the whole response body the sidecar returns. They
pin the Python sidecar to the shared Zod schemas that the Bun API parses those
bodies with, so a renamed field fails a pull request instead of production.

- `contract_fixtures.py` keeps the representative raw Garmin payloads and
  rebuilds the responses by calling the sidecar's own route handlers.
- `test_contract.py` (part of `bun run check:garmin`) asserts the sidecar still
  produces exactly the committed JSON.
- `apps/api/src/garmin/contract.test.ts` (part of `bun run test`) parses the same
  files with the shared schemas.

After a deliberate wire change, regenerate the fixtures:

```sh
cd services/garmin
UPDATE_CONTRACT_FIXTURES=1 .venv/bin/python -m pytest test_contract.py
```

Then make the shared schemas and the code that consumes them match, and let the
Bun test prove the new body parses. The normal test run only reads the files. See
`docs/specs/garmin-sidecar-contract.md` and ADR 0057.

## Notes

- MFA-required Garmin accounts are **not supported** and return 403.
- The `/sync` activities are normalized to the shared `Activity` shape
  (`id`, `name`, `type`, `startDate` ISO-8601 UTC, `distance` m, `movingTime` s,
  `elapsedTime` s, `totalElevationGain` m, `averageSpeed` and `maxSpeed` m/s)
  plus a `samples` timeseries. When Garmin leaves the summary speed at zero but
  records distance and duration, `averageSpeed` is derived from them.
- The `/metrics` response contains one `{ date, weightKg?, bodyFatPercent? }`
  entry per weigh-in in the same 42-day window, plus a `ftp` list of
  `{ date, watts }` samples from Garmin's historic cycling FTP. Weight is always
  kilograms (pounds and grams are converted) and body fat is always a
  percentage. A failed FTP fetch leaves the body measurements intact.
- Each sample is built from Garmin's `get_activity_details()` metrics and
  contains a UTC `timestamp` plus any recorded channels: `latitude`,
  `longitude`, `heartRate` (bpm), `power` (W), `temperature` (°C), `speed`
  (m/s), `distance` (m, cumulative), `elevation` (m), and `cadence`. Absent
  channels are omitted per sample.
- Strength activities also carry `strengthSets`: the exercises, repetitions,
  weight (converted from grams to kilograms) and rest intervals recorded with
  the activity. Non-strength activities have no `strengthSets` field. A failed
  set fetch leaves the activity without sets; a `429` still fails the sync.
- Activities also carry `laps`, from `get_activity_splits()`: each lap's index,
  type, start time, distance, moving/elapsed time, average and maximum power,
  average and maximum heart rate, average speed, cadence and elevation gain.
  Unrecorded channels are omitted and the list is capped at 100 laps. A
  single-lap result is treated as no laps, because it only restates the whole
  activity. A failed splits fetch leaves the activity without laps; a `429`
  still fails the sync.
- `/daily` combines Garmin's daily stats bundle with sleep, training readiness
  and max metrics. It returns only the values that were recorded, using the
  stable metric keys in `packages/shared/src/health.ts`. Body composition stays
  on `/metrics` so no weigh-in is fetched twice.
- Cadence matches what Garmin Connect shows: every step-counted sport (runs,
  jogs, walks and hikes) uses total steps per minute (`directDoubleCadence`, or
  twice the per-leg `directCadence`), rides use pedalling rpm
  (`directBikeCadence`, falling back to `directCadence`), and rows and swims use
  the stroke rate from `directStrokeCadence`. A lap's `averageRunCadence` is
  already total steps per minute and is never doubled, while its legacy
  `avgCadence` fallback is doubled for step-counted sports. See
  `docs/specs/cadence-units.md`. `directFractionalCadence` is only the sub-unit
  remainder and is never read as a cadence on its own.
- Activity-detail calls add one Garmin request per activity. If a detail fetch
  fails, that activity is returned with `samples: []` and the sync continues;
  Garmin rate limiting still fails the whole sync with `429`.
