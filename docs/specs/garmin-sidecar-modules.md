# Spec: Garmin sidecar modules and its shared failure boundary

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** issue #339, ADR 0058, ADR 0057,
  `docs/specs/garmin-activity-integration.md`,
  `docs/specs/garmin-sidecar-checks.md`,
  `docs/specs/garmin-sidecar-contract.md`.

## Goal

`services/garmin/app.py` had grown to 1,145 lines mixing the FastAPI routes,
login/session handling, activity, sample, lap, strength-set, body-composition,
FTP and daily-health normalization. Garmin rate-limit handling was copied at
every client call, and every route repeated `except HTTPException: raise` plus a
call to the error mapper. A new route or a new Garmin call could forget either
copy and fail with the wrong status.

Give each concern its own module, leave `app.py` as the app and its routes, and
give the sidecar one rate-limit handler and one route error boundary.

## Scope

### In scope

1. One module per concern:
   - `app.py` — the FastAPI app, the request models and the five routes
     (`/health`, `/authenticate`, `/sync`, `/metrics`, `/daily`). No
     normalization and no Garmin client calls beyond delegating to a module.
   - `auth.py` — `Credentials`, the per-username token store and `login`.
   - `activities.py` — the sync window's activity summaries, detail samples,
     laps and strength sets.
   - `body.py` — weigh-ins, body fat and historic cycling FTP.
   - `daily.py` — one day of daily stats, sleep, readiness and VO2max.
   - `values.py` — the value and date coercions shared by the normalizers
     (`finite_or_none`, `first_*`, `put_metric`, `iso`, plain dates, the 42-day
     window).
   - `errors.py` — the domain failure taxonomy, the one Garmin rate-limit
     context manager (`rate_limited`), the route error boundary
     (`http_errors`) and its status mapping (`http_error`).
2. One rate-limit handler. Every call that can raise Garmin's
   `GarminConnectTooManyRequestsError` wraps the call in `rate_limited()`, which
   raises `RateLimitedError` with the endpoint-appropriate sentence.
3. One route error boundary. Every route is decorated with `@http_errors`, which
   passes an `HTTPException` through and maps any other failure with
   `http_error`, so a new route cannot forget the mapping.
4. The Python suite split along the same lines: `test_auth.py`,
   `test_activities.py`, `test_body.py`, `test_daily.py`, `test_values.py`,
   `test_errors.py` and the unchanged `test_contract.py`, with the shared Garmin
   stubs in `support.py`.
5. The Docker image copies every runtime module, and `pyproject.toml` collects
   every test module and type-checks every module.

### Out of scope

- Changing the HTTP wire bodies, the status mapping, the log messages an
  operator sees for a given failure, the sync window or any normalization rule.
- Restructuring the sidecar into a package (`services/garmin/sidecar/`). Flat
  modules keep `python app.py`, `uvicorn app:app` and the Docker `COPY` simple.
- Generating the normalizers from the shared Zod schemas (ADR 0057).

## Acceptance criteria

1. `app.py` contains only the app, the request models and the routes; no
   normalizer and no direct Garmin client call.
2. No module repeats the rate-limit mapping or the route `except HTTPException`
   block.
3. `services/garmin/contract/{sync,metrics,daily}.json` are byte-identical
   before and after the refactor.
4. Every test that existed before the split still exists and still asserts the
   same behaviour, in the module for the code it covers. New tests cover the
   rate-limit wrapper and the route error mapping, which were previously
   untested.
5. `bun run check:garmin` (pytest, `ruff check`, `ruff format --check`, `mypy`)
   passes, and the other repository gates are unaffected.
6. `AGENTS.md`, `services/garmin/README.md` and the Garmin specs/ADRs name the
   new modules.

## Module boundaries

| Module          | Owns                                                                | Imports                                                   |
| --------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| `app.py`        | FastAPI app, request models, routes                                 | `auth`, `activities`, `body`, `daily`, `values`, `errors` |
| `auth.py`       | Login, token store, credentials                                     | `errors`                                                  |
| `activities.py` | Activity summaries, samples, laps, strength sets, sync window calls | `auth`, `values`, `errors`                                |
| `body.py`       | Body composition, weight/fat conversion, historic FTP               | `auth`, `values`, `errors`                                |
| `daily.py`      | Daily stats, sleep, readiness, VO2max                               | `auth`, `values`, `errors`                                |
| `values.py`     | Numeric/date coercions, metric ranges, the sync window              | stdlib only                                               |
| `errors.py`     | Domain errors, rate-limit context manager, HTTP error mapping       | `fastapi`, `garminconnect`                                |

Dependencies point one way: normalizers import `values`, `auth` and `errors`;
`auth` imports `errors`; `errors` imports neither; `app` composes the rest.

## Failure policy

- **Required Garmin call** (activity list, body composition): a `429` becomes
  `RateLimitedError` (status `429`); any other failure is logged and becomes
  `UpstreamError` (status `502`).
- **Optional Garmin call** (activity details, splits, exercise sets, each daily
  source): a `429` becomes `RateLimitedError` and aborts the endpoint; any other
  failure is logged and leaves that channel empty.
- **Supplementary FTP call:** unchanged — any failure, including a `429`, leaves
  the weigh-ins intact and yields no FTP samples.
- **Login:** a `429` becomes `RateLimitedError` with the login sentence, rejected
  credentials `LoginError` (`401`), an unreachable Garmin `UpstreamError`
  (`502`), and an MFA-required account `MfaRequiredError` (`403`).
- **Route boundary:** an `HTTPException` (for example `/daily`'s `400` for a
  malformed date) passes through; every domain error maps to its status; an
  unknown exception is logged and becomes the generic `500`.

## Data-model and API impact

None. The sidecar's HTTP contract, the committed fixtures, the shared schemas
and the API routes are unchanged.
