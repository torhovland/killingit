"""Garmin activity sync sidecar.

A minimal HTTP service that wraps `python-garminconnect` so the Bun/Hono API
can pull the operator's last 31 days of Garmin activities without adding a
Python runtime to the main backend (see ADR 0003 amendment).

Endpoints:
  POST /authenticate   { "username", "password" } -> 204 (or 401/403/429/502)
  POST /sync           { "username", "password" } -> { "activities": [...] }
  GET  /health         -> {"status": "ok"}

Garmin rate-limits repeated SSO logins aggressively (429), so the sidecar
persists the Garmin token store per username and reuses it: `/authenticate`
performs the one real login, and the immediately-following `/sync` resumes from
those tokens instead of logging in again.

The /sync response activities are normalized to the same shape the web app and
shared types expect: id, name, type, startDate (ISO 8601 UTC), distance (m),
movingTime (s), elapsedTime (s), totalElevationGain (m).
"""

from __future__ import annotations

import hashlib
import logging
import os
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException
from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)
from pydantic import BaseModel

logger = logging.getLogger("garmin-sidecar")

app = FastAPI(title="killingit-garmin-sidecar")

# Number of days of history to sync (inclusive window ending today).
SYNC_WINDOW_DAYS = 31

# Where the library caches Garmin session tokens between calls. Configurable so
# deployments can point it at a persistent volume; defaults to a private temp
# dir (created 0700). Tokens are single-operator, so one store per username.
TOKENSTORE_ROOT = Path(
    os.environ.get("GARMIN_TOKENSTORE_DIR")
    or Path(tempfile.gettempdir()) / "killingit-garmin-tokens"
)


class Credentials(BaseModel):
    username: str
    password: str


class _LoginError(Exception):
    """Garmin rejected the supplied credentials."""


class _MfaRequiredError(Exception):
    """Garmin requires multi-factor authentication."""


class _RateLimitedError(Exception):
    """Garmin is rate limiting logins / requests (HTTP 429)."""


class _UpstreamError(Exception):
    """Garmin returned an unexpected error."""


def _tokenstore_for(username: str) -> str:
    """Per-username token-store path (hashed so the dir name carries no PII)."""
    TOKENSTORE_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    digest = hashlib.sha256(username.encode("utf-8")).hexdigest()[:16]
    return str(TOKENSTORE_ROOT / digest)


def _login(credentials: Credentials) -> Garmin:
    """Log in (or resume from cached tokens) and map failures to clear errors."""
    try:
        garmin = Garmin(email=credentials.username, password=credentials.password)
        needs_mfa, _ = garmin.login(tokenstore=_tokenstore_for(credentials.username))
        if needs_mfa:
            raise _MfaRequiredError(
                "Garmin account requires multi-factor authentication, which "
                "is not supported by this integration"
            )
    except _MfaRequiredError:
        raise
    except GarminConnectTooManyRequestsError as exc:
        raise _RateLimitedError(
            "Garmin is rate limiting logins. Wait a few minutes and try again."
        ) from exc
    except GarminConnectAuthenticationError as exc:
        raise _LoginError("invalid Garmin credentials") from exc
    except GarminConnectConnectionError as exc:
        raise _UpstreamError("could not reach Garmin Connect") from exc
    except Exception as exc:  # noqa: BLE001 - library raises several types
        logger.exception("unexpected Garmin login failure")
        raise _UpstreamError("unexpected Garmin login failure") from exc
    return garmin


def _date_window(now: datetime | None = None) -> tuple[str, str]:
    """Return the inclusive (start, end) dates for the sync window, YYYY-MM-DD.

    `get_activities_by_date` requires plain dates, not ISO timestamps.
    """
    end = (now or datetime.now(UTC)).date()
    start = end - timedelta(days=SYNC_WINDOW_DAYS)
    return start.isoformat(), end.isoformat()


def _sync(credentials: Credentials) -> list[dict]:
    garmin = _login(credentials)
    startdate, enddate = _date_window()

    try:
        raw_activities = garmin.get_activities_by_date(startdate, enddate)
    except GarminConnectTooManyRequestsError as exc:
        raise _RateLimitedError(
            "Garmin is rate limiting requests. Wait a few minutes and try again."
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Garmin activity fetch failed")
        raise _UpstreamError("Garmin activity fetch failed") from exc

    return [_to_activity(raw) for raw in raw_activities or []]


def _to_activity(raw: dict) -> dict:
    """Map a Garmin activity to the shared normalized shape."""

    def _num(value, default: float = 0.0) -> float:
        try:
            return float(value) if value is not None else default
        except (TypeError, ValueError):
            return default

    start = raw.get("startTimeLocal")
    return {
        "id": int(raw.get("activityId") or 0),
        "name": raw.get("activityName") or "",
        "type": normalize_type(raw.get("activityType") or "unknown"),
        "startDate": _iso(start) if start else "",
        "distance": _num(raw.get("distance")),
        "movingTime": _num(raw.get("movingDuration")),
        "elapsedTime": _num(raw.get("duration")),
        "totalElevationGain": _num(raw.get("elevationGain")),
    }


def normalize_type(activity_type) -> str:
    """Lowercase the Garmin activity type key so it matches non-Garmin sources."""
    if not activity_type:
        return "unknown"
    if isinstance(activity_type, dict):
        key = activity_type.get("typeKey")
        return str(key).lower() if key else "unknown"
    return activity_type.lower()


def _iso(value) -> str:
    """Normalize a Garmin timestamp to an ISO 8601 UTC string."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    text = str(value)
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return text
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _http_error(exc: Exception) -> HTTPException:
    """Map a sidecar domain error to an HTTP response."""
    if isinstance(exc, _LoginError):
        return HTTPException(status_code=401, detail=str(exc))
    if isinstance(exc, _MfaRequiredError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, _RateLimitedError):
        return HTTPException(status_code=429, detail=str(exc))
    if isinstance(exc, _UpstreamError):
        return HTTPException(status_code=502, detail=str(exc))
    logger.exception("unhandled sidecar error")
    return HTTPException(status_code=500, detail="internal sidecar error")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "killingit-garmin-sidecar"}


@app.post("/authenticate", status_code=204)
def authenticate(credentials: Credentials):
    try:
        _login(credentials)
    except Exception as exc:  # noqa: BLE001 - translated to HTTP below
        raise _http_error(exc) from exc
    return None


@app.post("/sync")
def sync(credentials: Credentials) -> dict:
    try:
        return {"activities": _sync(credentials)}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - translated to HTTP below
        raise _http_error(exc) from exc


def _run() -> None:
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))


if __name__ == "__main__":
    _run()
