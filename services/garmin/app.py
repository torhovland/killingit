"""Garmin activity sync sidecar: the FastAPI app and its routes.

A minimal HTTP service that wraps `python-garminconnect` so the Bun/Hono API
can pull the operator's last 42 days of Garmin activities without adding a
Python runtime to the main backend (see ADR 0003 amendment).

Endpoints:
  POST /authenticate   { "username", "password" } -> 204 (or 401/403/429/502)
  POST /sync           { "username", "password", "knownActivityIds"? }
                       -> { "activities": [...] }
  POST /metrics        { "username", "password" } -> { "metrics": [...] }
  POST /daily          { "username", "password", "date" } -> metrics + date
  GET  /health         -> {"status": "ok"}

The behaviour lives beside this module: `auth` owns login and the session token
store, `activities` the activity, sample, lap and strength-set normalization,
`body` the weigh-ins and historic FTP, `daily` the daily health values, `values`
the shared coercions and `errors` the failure taxonomy. Every route goes through
`errors.http_errors`, so a new route cannot forget the status mapping. See
ADR 0058.

This module deliberately does not use `from __future__ import annotations`:
FastAPI resolves a wrapped route's annotations through the decorator's module
globals, so string annotations such as `Credentials` would be looked up in
`errors.py`. Real annotation objects are used as they are.
"""

import os

from fastapi import FastAPI, HTTPException
from pydantic import Field

import activities
import auth
import body
import daily as daily_health
import values
from errors import http_errors

app = FastAPI(title="killingit-garmin-sidecar")


class SyncRequest(auth.Credentials):
    """The `/sync` body. An absent id list means nothing is stored yet.

    Ids are strings on the wire; a number is accepted too because Garmin's own
    ids are numeric.
    """

    known_activity_ids: list[str | int] | None = Field(
        default=None, alias="knownActivityIds"
    )


class DailyRequest(auth.Credentials):
    date: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "killingit-garmin-sidecar"}


@app.post("/authenticate", status_code=204)
@http_errors
def authenticate(credentials: auth.Credentials) -> None:
    auth.login(credentials)
    return None


@app.post("/sync")
@http_errors
def sync(request: SyncRequest) -> dict:
    known_ids = request.known_activity_ids or []
    return {"activities": activities.sync_activities(request, known_ids)}


@app.post("/metrics")
@http_errors
def metrics(credentials: auth.Credentials) -> dict:
    return body.sync_metrics(credentials)


@app.post("/daily")
@http_errors
def daily(request: DailyRequest) -> dict:
    if not values.is_plain_date(request.date):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    return daily_health.sync_daily(request, request.date)


def _run() -> None:
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))


if __name__ == "__main__":
    _run()
