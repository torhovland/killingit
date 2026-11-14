"""Garmin login and the per-username session token store.

Garmin rate-limits SSO logins aggressively, so the library's token store is
persisted per username and reused: one real login, then every later call resumes
from the cached tokens. Login failures are mapped onto the sidecar's domain
errors here; HTTP translation belongs to `errors.http_errors`. See ADR 0058.
"""

from __future__ import annotations

import hashlib
import logging
import os
import tempfile
from pathlib import Path

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
)
from pydantic import BaseModel

from errors import (
    LoginError,
    MfaRequiredError,
    RateLimitedError,
    UpstreamError,
    rate_limited,
)

logger = logging.getLogger("garmin-sidecar")

# Where the library caches Garmin session tokens between calls. Configurable so
# deployments can point it at a persistent volume; defaults to a private temp
# dir (created 0700). Tokens are single-operator, so one store per username.
TOKENSTORE_ROOT = Path(
    os.environ.get("GARMIN_TOKENSTORE_DIR")
    or Path(tempfile.gettempdir()) / "killingit-garmin-tokens"
)

LOGIN_RATE_LIMIT_MESSAGE = (
    "Garmin is rate limiting logins. Wait a few minutes and try again."
)


class Credentials(BaseModel):
    username: str
    password: str


def tokenstore_for(username: str) -> str:
    """Per-username token-store path (hashed so the dir name carries no PII)."""
    TOKENSTORE_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    digest = hashlib.sha256(username.encode("utf-8")).hexdigest()[:16]
    return str(TOKENSTORE_ROOT / digest)


def login(credentials: Credentials) -> Garmin:
    """Log in (or resume from cached tokens) and map failures to clear errors."""
    try:
        garmin = Garmin(email=credentials.username, password=credentials.password)
        with rate_limited(LOGIN_RATE_LIMIT_MESSAGE):
            needs_mfa, _ = garmin.login(tokenstore=tokenstore_for(credentials.username))
        if needs_mfa:
            raise MfaRequiredError(
                "Garmin account requires multi-factor authentication, which "
                "is not supported by this integration"
            )
    except (MfaRequiredError, RateLimitedError):
        raise
    except GarminConnectAuthenticationError as exc:
        raise LoginError("invalid Garmin credentials") from exc
    except GarminConnectConnectionError as exc:
        raise UpstreamError("could not reach Garmin Connect") from exc
    except Exception as exc:  # the library raises several types
        logger.exception("unexpected Garmin login failure")
        raise UpstreamError("unexpected Garmin login failure") from exc
    return garmin
