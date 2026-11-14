# ADR 0058: Split the Garmin sidecar by concern and share one failure boundary

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** issue #339, `docs/specs/garmin-sidecar-modules.md`, ADR 0057,
  ADR 0035

## Context

`services/garmin/app.py` held the FastAPI app, the request models, login and
token-store handling, activity-summary mapping, detail samples, laps, strength
sets, body composition, historic FTP and daily health in one 1,145-line module.
Two kinds of duplication had grown with it:

- Garmin's `GarminConnectTooManyRequestsError` was caught and re-raised as the
  sidecar's `RateLimitedError` at five call sites, each carrying its own copy of
  the same sentence.
- Every route repeated `except HTTPException: raise` followed by
  `raise _http_error(exc) from exc`.

Both are the kind of duplication that fails silently: a new Garmin call without
the first copy lets a `429` escape as an unknown library error (a `500`), and a
new route without the second returns the wrong status for a rejected login or a
rate limit. The module also made the test file grow beside it, so a change to
one concern touched the tests of all of them.

## Decision

Split the sidecar into one module per concern and share the failure handling.

- `app.py` keeps the FastAPI app, the request models and the routes only. A
  route validates its input, calls one module function and returns the result.
- `auth.py`, `activities.py`, `body.py` and `daily.py` own the four concerns the
  issue named. Two further modules own genuinely shared ground:
  `values.py` for the value and date coercions the normalizers all use, and
  `errors.py` for the failure taxonomy and the two shared handlers.
- `rate_limited()` is the single rate-limit handler: a context manager that
  turns Garmin's `429` into `RateLimitedError` with the sentence the endpoint
  should show. Required calls add their own upstream mapping around it;
  optional calls re-raise the rate limit and otherwise leave the channel empty.
- `http_errors` is the single route error boundary: a decorator that passes an
  `HTTPException` through and maps every other failure with `http_error`. Every
  route is decorated with it, so the mapping lives one decorator away from a new
  route instead of being copied into it.
- Only the standard library, `fastapi`, `garminconnect` and `pydantic` are
  imported. Dependencies point one way: normalizers import `auth`, `values` and
  `errors`; `auth` imports `errors`; `errors` imports neither; `app` composes
  them, so no import cycle can form.
- The Python suite splits along the same lines. Shared Garmin stubs live in
  `support.py`; the committed contract fixtures keep calling the real route
  handlers, so the wire bodies are pinned across the split.

## Alternatives considered

- **A FastAPI exception handler instead of the route decorator.** It is the
  idiomatic way to translate an exception for HTTP, but it only runs when a
  request comes through the ASGI app. The contract fixtures and the unit tests
  call the route functions directly, and the API's behaviour under a raised
  domain error would then be untested at the boundary that maps it. The
  decorator works both ways. Rejected.
- **A class per concern with injected dependencies.** It would make the Garmin
  client swappable through a constructor, but the tests already patch the one
  seam they need (`auth.login`), and the sidecar is a small adapter with a
  single client. The extra indirection buys nothing here. Rejected.
- **A `sidecar/` package with `__init__.py`.** It would namespace the modules,
  but the deployment runs `python app.py`, the dev server runs `uvicorn app:app`
  with `--app-dir services/garmin`, and the Docker image copies `app.py`. Flat
  modules keep all three unchanged and avoid a second name for every import.
  Rejected.
- **Keeping the shared coercions in `activities.py` and importing them from
  `body.py` and `daily.py`.** It saves a module but makes body and daily depend
  on activities for arithmetic they have nothing to do with, and invites the
  next shared helper to land in whichever module was edited last. Rejected.

## Consequences

- A new route must use `@http_errors`; a new Garmin call must use
  `rate_limited()`. Both are one line, and the test suite covers the mapping
  itself, so the failure policy is one place rather than one copy per call.
- A new module has three registration points: the Dockerfile's `COPY`, the
  `pyproject.toml` pytest `testpaths` and mypy `files`. The spec lists them, and
  `bun run check:garmin` fails when a test module is not collected.
- `app.py` cannot use `from __future__ import annotations`: FastAPI resolves the
  annotations of the wrapped route through the decorator's module globals, so a
  string annotation such as `"Credentials"` would be looked up in `errors.py`.
  Real annotation objects (the default without the future import) are used
  as-is. The module says so beside the routes.
- The refactor is behaviour-preserving by construction: the committed contract
  fixtures must stay byte-identical, and the unit tests move without changing an
  assertion.
- The sidecar keeps its flat import style, so `import auth` and `import errors`
  rely on the script directory being first on `sys.path` as it already was for
  `import app`.
